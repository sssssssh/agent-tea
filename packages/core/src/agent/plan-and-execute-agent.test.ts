import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { PlanAndExecuteAgent } from './plan-and-execute-agent.js';
import { tool } from '../tools/builder.js';
import type { LLMProvider, ChatSession, ChatOptions } from '../llm/provider.js';
import type { Message, ChatStreamEvent } from '../llm/types.js';
import type { AgentEvent, Plan, PlanApproval, StepFailureAction } from './types.js';

// --- Mock LLM Provider ---

/**
 * Create a mock provider where you specify the sequence of responses.
 * Each response is an array of ChatStreamEvents.
 */
function mockProvider(responses: ChatStreamEvent[][]): LLMProvider {
    let callIndex = 0;

    return {
        id: 'mock',
        chat(_options: ChatOptions): ChatSession {
            return {
                async *sendMessage(
                    _messages: Message[],
                    _signal?: AbortSignal,
                ): AsyncGenerator<ChatStreamEvent> {
                    const events = responses[callIndex++];
                    if (!events) throw new Error('No more mock responses');
                    for (const event of events) {
                        yield event;
                    }
                },
            };
        },
    };
}

/** Collect all events from agent.run() */
async function collectEvents(agent: PlanAndExecuteAgent, input: string): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for await (const event of agent.run(input)) {
        events.push(event);
    }
    return events;
}

// --- Test Tools ---

const readFileTool = tool(
    {
        name: 'read_file',
        description: 'Read a file',
        parameters: z.object({ path: z.string() }),
        tags: ['readonly'],
    },
    async ({ path: filePath }) => `Content of ${filePath}`,
);

const writeFileTool = tool(
    {
        name: 'write_file',
        description: 'Write a file',
        parameters: z.object({ path: z.string(), content: z.string() }),
        tags: ['write'],
    },
    async ({ path: filePath, content }) => `Wrote ${content.length} bytes to ${filePath}`,
);

const searchTool = tool(
    {
        name: 'search',
        description: 'Search codebase',
        parameters: z.object({ query: z.string() }),
        tags: ['readonly'],
    },
    async ({ query }) => `Found 3 results for "${query}"`,
);

// --- Test Helpers ---

let tmpDirs: string[] = [];

async function createTmpDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-agent-test-'));
    tmpDirs.push(dir);
    return dir;
}

afterEach(async () => {
    for (const dir of tmpDirs) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs = [];
});

// --- Tests ---

describe('PlanAndExecuteAgent', () => {
    it('completes full planning → approval → execution flow', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            // Planning phase: LLM calls a readonly tool first
            [
                { type: 'tool_call', id: 'tc1', name: 'read_file', args: { path: 'src/index.ts' } },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // Planning phase: LLM outputs a plan after exploring
            [
                {
                    type: 'text',
                    text: '```plan\n1. Create the configuration file\n2. Update the main module\n```',
                },
                { type: 'finish', reason: 'stop' },
            ],
            // Execution phase step 1: LLM calls a write tool
            [
                {
                    type: 'tool_call',
                    id: 'tc2',
                    name: 'write_file',
                    args: { path: 'config.ts', content: 'export default {}' },
                },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // Execution phase step 1: LLM completes
            [
                { type: 'text', text: 'Configuration file created.' },
                { type: 'finish', reason: 'stop' },
            ],
            // Execution phase step 2: LLM completes directly
            [
                { type: 'text', text: 'Main module updated.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new PlanAndExecuteAgent({
            provider,
            model: 'test-model',
            tools: [readFileTool, writeFileTool, searchTool],
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Build a new feature');

        // Verify state transitions
        const stateChanges = events.filter((e) => e.type === 'state_change');
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'idle', to: 'planning' }),
        );
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'planning', to: 'awaiting_approval' }),
        );
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'awaiting_approval', to: 'executing' }),
        );
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'executing', to: 'completed' }),
        );

        // Verify plan_created event
        const planCreated = events.find((e) => e.type === 'plan_created');
        expect(planCreated).toBeDefined();
        if (planCreated?.type === 'plan_created') {
            expect(planCreated.plan.steps).toHaveLength(2);
            expect(planCreated.plan.steps[0].description).toBe('Create the configuration file');
            expect(planCreated.plan.steps[1].description).toBe('Update the main module');
        }

        // Verify step events
        const stepStarts = events.filter((e) => e.type === 'step_start');
        expect(stepStarts).toHaveLength(2);

        const stepCompletes = events.filter((e) => e.type === 'step_complete');
        expect(stepCompletes).toHaveLength(2);

        // Verify tool events: read_file during planning, write_file during execution
        const toolRequests = events.filter((e) => e.type === 'tool_request');
        expect(toolRequests).toContainEqual(expect.objectContaining({ toolName: 'read_file' }));
        expect(toolRequests).toContainEqual(expect.objectContaining({ toolName: 'write_file' }));

        // Verify agent lifecycle
        expect(events[0].type).toBe('agent_start');
        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'complete',
        });
    });

    it('only allows readonly tools during planning phase', async () => {
        const tmpDir = await createTmpDir();

        // Track which tools are available at each chat() call
        const toolSetsPerCall: string[][] = [];

        const provider: LLMProvider = {
            id: 'mock',
            chat(options: ChatOptions): ChatSession {
                // Record tool names available for this session
                toolSetsPerCall.push(options.tools?.map((t) => t.name) ?? []);

                let callCount = 0;
                return {
                    async *sendMessage(): AsyncGenerator<ChatStreamEvent> {
                        callCount++;
                        if (toolSetsPerCall.length === 1 && callCount === 1) {
                            // Planning phase: just output a plan directly
                            yield {
                                type: 'text',
                                text: '1. Do something\n2. Do another thing',
                            };
                            yield { type: 'finish', reason: 'stop' };
                        } else {
                            // Execution phase
                            yield { type: 'text', text: 'Step done.' };
                            yield { type: 'finish', reason: 'stop' };
                        }
                    },
                };
            },
        };

        const agent = new PlanAndExecuteAgent({
            provider,
            model: 'test-model',
            tools: [readFileTool, writeFileTool, searchTool],
            planStoreDir: tmpDir,
        });

        await collectEvents(agent, 'Build something');

        // First call (planning): only readonly tools
        expect(toolSetsPerCall[0]).toEqual(['read_file', 'search']);
        // Subsequent calls (execution): all tools
        for (let i = 1; i < toolSetsPerCall.length; i++) {
            expect(toolSetsPerCall[i]).toEqual(
                expect.arrayContaining(['read_file', 'write_file', 'search']),
            );
        }
    });

    it('handles plan rejection and re-planning', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            // First planning attempt
            [
                { type: 'text', text: '1. Bad step' },
                { type: 'finish', reason: 'stop' },
            ],
            // Second planning attempt (after rejection feedback)
            [
                { type: 'text', text: '1. Good step' },
                { type: 'finish', reason: 'stop' },
            ],
            // Execution of good plan
            [
                { type: 'text', text: 'Step completed successfully.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        let planCallCount = 0;

        class TestAgent extends PlanAndExecuteAgent {
            protected async onPlanCreated(plan: Plan): Promise<PlanApproval> {
                planCallCount++;
                if (planCallCount === 1) {
                    // Reject first plan
                    return { approved: false, feedback: 'Too vague, be more specific' };
                }
                return { approved: true };
            }
        }

        const agent = new TestAgent({
            provider,
            model: 'test-model',
            tools: [readFileTool],
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Build something');

        const stateChanges = events.filter((e) => e.type === 'state_change');

        // Should show: idle→planning, planning→awaiting_approval (first plan),
        // awaiting_approval→planning (rejected), planning→awaiting_approval (second plan),
        // awaiting_approval→executing, executing→completed
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'awaiting_approval', to: 'planning' }),
        );

        // Should have 2 plan_created events
        const planCreatedEvents = events.filter((e) => e.type === 'plan_created');
        expect(planCreatedEvents).toHaveLength(2);

        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'complete',
        });
    });

    it('handles step failure with skip action', async () => {
        const tmpDir = await createTmpDir();

        const failingTool = tool(
            {
                name: 'fail',
                description: 'Always fails',
                parameters: z.object({}),
            },
            async () => {
                throw new Error('Tool failure');
            },
        );

        const provider = mockProvider([
            // Planning phase
            [
                { type: 'text', text: '1. Try failing tool\n2. Do something else' },
                { type: 'finish', reason: 'stop' },
            ],
            // Execution step 1: calls failing tool
            [
                { type: 'tool_call', id: 'tc1', name: 'fail', args: {} },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // Step 1 continues after tool error (LLM sees error and stops)
            [
                { type: 'text', text: 'The tool failed, task cannot complete.' },
                { type: 'finish', reason: 'stop' },
            ],
            // Execution step 2: succeeds
            [
                { type: 'text', text: 'Done with step 2.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        // Note: The failing tool returns an error result, but doesn't throw.
        // For the step to actually "fail", we need the step execution to throw.
        // Let's test with a simpler scenario: step execution exceeds max iterations.

        // Actually, let's test the skip flow by making onStepFailed return 'skip'
        // and having the step throw during execution.

        // Simpler approach: use a provider that errors during step execution
        const errorProvider = mockProvider([
            // Planning phase
            [
                { type: 'text', text: '1. First step\n2. Second step' },
                { type: 'finish', reason: 'stop' },
            ],
            // Step 1: provider throws
            [{ type: 'error', error: new Error('LLM API error during step 1') }],
            // Step 2: succeeds
            [
                { type: 'text', text: 'Step 2 done.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        class SkipAgent extends PlanAndExecuteAgent {
            protected async onStepFailed(
                _step: unknown,
                _error: Error,
            ): Promise<StepFailureAction> {
                return 'skip';
            }
        }

        const agent = new SkipAgent({
            provider: errorProvider,
            model: 'test-model',
            tools: [],
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Do two things');

        const stateChanges = events.filter((e) => e.type === 'state_change');

        // Should contain step_failed and recovery back to executing
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'executing', to: 'step_failed' }),
        );
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'step_failed', to: 'executing' }),
        );

        // Should complete successfully (step 2 succeeded)
        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'complete',
        });
    });

    it('handles step failure with abort action', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            // Planning phase
            [
                { type: 'text', text: '1. This will fail' },
                { type: 'finish', reason: 'stop' },
            ],
            // Step 1: provider throws
            [{ type: 'error', error: new Error('Critical failure') }],
        ]);

        // Default onStepFailed returns 'abort'
        const agent = new PlanAndExecuteAgent({
            provider,
            model: 'test-model',
            tools: [],
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Do something risky');

        const stateChanges = events.filter((e) => e.type === 'state_change');
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'step_failed', to: 'aborted' }),
        );

        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'abort',
        });
    });

    it('handles step failure with pause action', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            // Planning phase
            [
                { type: 'text', text: '1. First step\n2. Second step' },
                { type: 'finish', reason: 'stop' },
            ],
            // Step 1: provider throws
            [{ type: 'error', error: new Error('LLM API error during step 1') }],
        ]);

        class PauseAgent extends PlanAndExecuteAgent {
            protected async onStepFailed(
                _step: unknown,
                _error: Error,
            ): Promise<StepFailureAction> {
                return 'pause';
            }
        }

        const agent = new PauseAgent({
            provider,
            model: 'test-model',
            tools: [],
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Do two things');

        // Should emit execution_paused event
        const pausedEvents = events.filter((e) => e.type === 'execution_paused');
        expect(pausedEvents).toHaveLength(1);

        // Should transition step_failed → paused
        const stateChanges = events.filter((e) => e.type === 'state_change');
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'executing', to: 'step_failed' }),
        );
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'step_failed', to: 'paused' }),
        );

        // Should end with reason 'paused', not 'complete' or 'error'
        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'paused',
        });
    });

    it('handles step failure with replan action', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            // First planning phase
            [
                { type: 'text', text: '1. Risky step\n2. Safe step' },
                { type: 'finish', reason: 'stop' },
            ],
            // Step 1: provider throws
            [{ type: 'error', error: new Error('Step 1 exploded') }],
            // Second planning phase (replan): outputs a new plan
            [
                { type: 'text', text: '1. Alternative step' },
                { type: 'finish', reason: 'stop' },
            ],
            // Execution of new plan step 1
            [
                { type: 'text', text: 'Alternative step done.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        class ReplanAgent extends PlanAndExecuteAgent {
            protected async onStepFailed(
                _step: unknown,
                _error: Error,
            ): Promise<StepFailureAction> {
                return 'replan';
            }
        }

        const agent = new ReplanAgent({
            provider,
            model: 'test-model',
            tools: [],
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Do something');

        const stateChanges = events.filter((e) => e.type === 'state_change');

        // Should transition: step_failed → planning (replan)
        expect(stateChanges).toContainEqual(
            expect.objectContaining({ from: 'step_failed', to: 'planning' }),
        );

        // Should have 2 plan_created events (original + replan)
        const planCreatedEvents = events.filter((e) => e.type === 'plan_created');
        expect(planCreatedEvents).toHaveLength(2);

        // Second plan should have the alternative step
        if (planCreatedEvents[1]?.type === 'plan_created') {
            expect(planCreatedEvents[1].plan.steps).toHaveLength(1);
            expect(planCreatedEvents[1].plan.steps[0].description).toBe('Alternative step');
        }

        // Should complete successfully after replan
        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'complete',
        });
    });

    it('parses plan with numbered list format', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            [
                {
                    type: 'text',
                    text: 'Here is the plan:\n1. First step\n2. Second step\n3. Third step',
                },
                { type: 'finish', reason: 'stop' },
            ],
            // Execution steps
            [
                { type: 'text', text: 'Done 1' },
                { type: 'finish', reason: 'stop' },
            ],
            [
                { type: 'text', text: 'Done 2' },
                { type: 'finish', reason: 'stop' },
            ],
            [
                { type: 'text', text: 'Done 3' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new PlanAndExecuteAgent({
            provider,
            model: 'test-model',
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Plan something');

        const planCreated = events.find((e) => e.type === 'plan_created');
        if (planCreated?.type === 'plan_created') {
            expect(planCreated.plan.steps).toHaveLength(3);
            expect(planCreated.plan.steps[0].description).toBe('First step');
            expect(planCreated.plan.steps[1].description).toBe('Second step');
            expect(planCreated.plan.steps[2].description).toBe('Third step');
        }
    });

    it('parses plan with bullet list format', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            [
                {
                    type: 'text',
                    text: '- Install dependencies\n- Configure settings\n- Run tests',
                },
                { type: 'finish', reason: 'stop' },
            ],
            [
                { type: 'text', text: 'Done' },
                { type: 'finish', reason: 'stop' },
            ],
            [
                { type: 'text', text: 'Done' },
                { type: 'finish', reason: 'stop' },
            ],
            [
                { type: 'text', text: 'Done' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new PlanAndExecuteAgent({
            provider,
            model: 'test-model',
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Do it');

        const planCreated = events.find((e) => e.type === 'plan_created');
        if (planCreated?.type === 'plan_created') {
            expect(planCreated.plan.steps).toHaveLength(3);
            expect(planCreated.plan.steps[0].description).toBe('Install dependencies');
        }
    });

    it('treats unstructured text as single step', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            [
                { type: 'text', text: 'Just do the whole thing at once.' },
                { type: 'finish', reason: 'stop' },
            ],
            [
                { type: 'text', text: 'All done.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new PlanAndExecuteAgent({
            provider,
            model: 'test-model',
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Do it');

        const planCreated = events.find((e) => e.type === 'plan_created');
        if (planCreated?.type === 'plan_created') {
            expect(planCreated.plan.steps).toHaveLength(1);
            expect(planCreated.plan.steps[0].description).toBe('Just do the whole thing at once.');
        }
    });

    it('saves plan to temp directory via PlanStore', async () => {
        const tmpDir = await createTmpDir();

        const provider = mockProvider([
            [
                { type: 'text', text: '1. Step one' },
                { type: 'finish', reason: 'stop' },
            ],
            [
                { type: 'text', text: 'Done' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new PlanAndExecuteAgent({
            provider,
            model: 'test-model',
            planStoreDir: tmpDir,
        });

        const events = await collectEvents(agent, 'Do it');

        const planCreated = events.find((e) => e.type === 'plan_created');
        expect(planCreated).toBeDefined();
        if (planCreated?.type === 'plan_created') {
            // Verify file was actually created
            const content = await fs.readFile(planCreated.filePath, 'utf-8');
            const saved = JSON.parse(content);
            expect(saved.steps).toHaveLength(1);
            expect(saved.steps[0].description).toBe('Step one');
        }
    });
});
