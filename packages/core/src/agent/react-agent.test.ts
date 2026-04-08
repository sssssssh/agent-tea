import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ReActAgent } from './react-agent.js';
import { tool } from '../tools/builder.js';
import type { LLMProvider, ChatSession, ChatOptions } from '../llm/provider.js';
import type { Message, ChatStreamEvent } from '../llm/types.js';
import type { AgentEvent } from './types.js';

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
async function collectEvents(agent: ReActAgent, input: string): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for await (const event of agent.run(input)) {
        events.push(event);
    }
    return events;
}

describe('ReActAgent', () => {
    it('handles a simple text response (no tool calls)', async () => {
        const provider = mockProvider([
            [
                { type: 'text', text: 'Hello, world!' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new ReActAgent({ provider, model: 'test-model' });
        const events = await collectEvents(agent, 'Hi');

        expect(events[0].type).toBe('agent_start');
        expect(events).toContainEqual(
            expect.objectContaining({
                type: 'message',
                role: 'assistant',
                content: 'Hello, world!',
            }),
        );
        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'complete',
        });
    });

    it('handles a single tool call cycle', async () => {
        const greetTool = tool(
            {
                name: 'greet',
                description: 'Greet someone',
                parameters: z.object({ name: z.string() }),
            },
            async ({ name }) => `Hello, ${name}!`,
        );

        const provider = mockProvider([
            // First call: LLM requests tool call
            [
                { type: 'tool_call', id: 'tc1', name: 'greet', args: { name: 'Alice' } },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // Second call: LLM responds with text after seeing tool result
            [
                { type: 'text', text: 'I greeted Alice for you.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new ReActAgent({
            provider,
            model: 'test-model',
            tools: [greetTool],
        });

        const events = await collectEvents(agent, 'Greet Alice');

        // Should have tool_request and tool_response events
        const toolRequest = events.find((e) => e.type === 'tool_request');
        expect(toolRequest).toMatchObject({
            type: 'tool_request',
            toolName: 'greet',
        });

        const toolResponse = events.find((e) => e.type === 'tool_response');
        expect(toolResponse).toMatchObject({
            type: 'tool_response',
            toolName: 'greet',
            content: 'Hello, Alice!',
            isError: undefined,
        });

        // Should have final text response
        expect(events).toContainEqual(
            expect.objectContaining({
                type: 'message',
                role: 'assistant',
                content: 'I greeted Alice for you.',
            }),
        );
    });

    it('handles tool validation errors gracefully', async () => {
        const strictTool = tool(
            {
                name: 'strict',
                description: 'Requires a number',
                parameters: z.object({ count: z.number().min(1) }),
            },
            async ({ count }) => `Count: ${count}`,
        );

        const provider = mockProvider([
            // LLM sends invalid args
            [
                { type: 'tool_call', id: 'tc1', name: 'strict', args: { count: -5 } },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // LLM gets error result and responds
            [
                { type: 'text', text: 'Sorry, invalid input.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new ReActAgent({
            provider,
            model: 'test-model',
            tools: [strictTool],
        });

        const events = await collectEvents(agent, 'Count -5');

        const toolResponse = events.find((e) => e.type === 'tool_response');
        expect(toolResponse).toMatchObject({
            type: 'tool_response',
            isError: true,
        });
    });

    it('handles unknown tool names', async () => {
        const provider = mockProvider([
            [
                { type: 'tool_call', id: 'tc1', name: 'nonexistent', args: {} },
                { type: 'finish', reason: 'tool_calls' },
            ],
            [
                { type: 'text', text: 'Tool not found.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new ReActAgent({ provider, model: 'test-model' });
        const events = await collectEvents(agent, 'Do something');

        const toolResponse = events.find((e) => e.type === 'tool_response');
        expect(toolResponse).toMatchObject({
            type: 'tool_response',
            toolName: 'nonexistent',
            isError: true,
        });
    });

    it('respects maxIterations', async () => {
        // Provider always requests a tool call, creating an infinite loop
        let callCount = 0;
        const provider: LLMProvider = {
            id: 'mock',
            chat() {
                return {
                    async *sendMessage() {
                        callCount++;
                        yield {
                            type: 'tool_call' as const,
                            id: `tc${callCount}`,
                            name: 'echo',
                            args: { text: 'loop' },
                        };
                        yield { type: 'finish' as const, reason: 'tool_calls' as const };
                    },
                };
            },
        };

        const echoTool = tool(
            {
                name: 'echo',
                description: 'Echo text',
                parameters: z.object({ text: z.string() }),
            },
            async ({ text }) => text,
        );

        const agent = new ReActAgent({
            provider,
            model: 'test-model',
            tools: [echoTool],
            maxIterations: 3,
        });

        const events = await collectEvents(agent, 'Loop forever');

        const errorEvent = events.find((e) => e.type === 'error');
        expect(errorEvent).toMatchObject({
            type: 'error',
            fatal: true,
        });

        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'error',
        });
    });

    it('handles multiple tool calls in one turn', async () => {
        const addTool = tool(
            {
                name: 'add',
                description: 'Add two numbers',
                parameters: z.object({ a: z.number(), b: z.number() }),
            },
            async ({ a, b }) => String(a + b),
        );

        const provider = mockProvider([
            // LLM sends two tool calls at once
            [
                { type: 'tool_call', id: 'tc1', name: 'add', args: { a: 1, b: 2 } },
                { type: 'tool_call', id: 'tc2', name: 'add', args: { a: 3, b: 4 } },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // LLM responds after receiving both results
            [
                { type: 'text', text: '1+2=3, 3+4=7' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new ReActAgent({
            provider,
            model: 'test-model',
            tools: [addTool],
        });

        const events = await collectEvents(agent, 'Add 1+2 and 3+4');

        const toolResponses = events.filter((e) => e.type === 'tool_response');
        expect(toolResponses).toHaveLength(2);
        expect(toolResponses[0]).toMatchObject({ content: '3' });
        expect(toolResponses[1]).toMatchObject({ content: '7' });
    });

    it('handles LLM errors', async () => {
        const provider: LLMProvider = {
            id: 'mock',
            chat() {
                return {
                    async *sendMessage() {
                        yield { type: 'error' as const, error: new Error('API rate limit') };
                    },
                };
            },
        };

        const agent = new ReActAgent({ provider, model: 'test-model' });
        const events = await collectEvents(agent, 'Hello');

        expect(events).toContainEqual(
            expect.objectContaining({
                type: 'error',
                fatal: true,
                message: 'API rate limit',
            }),
        );
    });

    it('tracks usage events', async () => {
        const provider = mockProvider([
            [
                { type: 'text', text: 'Hi' },
                { type: 'finish', reason: 'stop', usage: { inputTokens: 10, outputTokens: 5 } },
            ],
        ]);

        const agent = new ReActAgent({ provider, model: 'gpt-4o' });
        const events = await collectEvents(agent, 'Hello');

        const usageEvent = events.find((e) => e.type === 'usage');
        expect(usageEvent).toMatchObject({
            type: 'usage',
            model: 'gpt-4o',
            usage: { inputTokens: 10, outputTokens: 5 },
        });
    });

    it('emits state_change events during lifecycle', async () => {
        const provider = mockProvider([
            [
                { type: 'text', text: 'Done' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const agent = new ReActAgent({ provider, model: 'test-model' });
        const events = await collectEvents(agent, 'Hello');

        const stateChanges = events.filter((e) => e.type === 'state_change');

        // idle -> reacting, reacting -> completed
        expect(stateChanges).toHaveLength(2);
        expect(stateChanges[0]).toMatchObject({
            type: 'state_change',
            from: 'idle',
            to: 'reacting',
        });
        expect(stateChanges[1]).toMatchObject({
            type: 'state_change',
            from: 'reacting',
            to: 'completed',
        });
    });

    it('emits state_change to error on max iterations', async () => {
        let callCount = 0;
        const provider: LLMProvider = {
            id: 'mock',
            chat() {
                return {
                    async *sendMessage() {
                        callCount++;
                        yield {
                            type: 'tool_call' as const,
                            id: `tc${callCount}`,
                            name: 'echo',
                            args: { text: 'loop' },
                        };
                        yield { type: 'finish' as const, reason: 'tool_calls' as const };
                    },
                };
            },
        };

        const echoTool = tool(
            {
                name: 'echo',
                description: 'Echo text',
                parameters: z.object({ text: z.string() }),
            },
            async ({ text }) => text,
        );

        const agent = new ReActAgent({
            provider,
            model: 'test-model',
            tools: [echoTool],
            maxIterations: 2,
        });

        const events = await collectEvents(agent, 'Loop');

        const stateChanges = events.filter((e) => e.type === 'state_change');

        // idle -> reacting, reacting -> error
        expect(stateChanges).toHaveLength(2);
        expect(stateChanges[0]).toMatchObject({ from: 'idle', to: 'reacting' });
        expect(stateChanges[1]).toMatchObject({ from: 'reacting', to: 'error' });
    });

    describe('timeout', () => {
        it('returns tool timeout error to LLM and continues', async () => {
            const slowTool = tool(
                {
                    name: 'slow_tool',
                    description: 'A tool that takes too long',
                    parameters: z.object({}),
                    timeout: 50,
                },
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    return 'done';
                },
            );

            const provider = mockProvider([
                [
                    { type: 'tool_call', id: 'tc1', name: 'slow_tool', args: {} },
                    { type: 'finish', reason: 'tool_calls' as const },
                ],
                [
                    { type: 'text', text: 'The tool timed out, sorry.' },
                    { type: 'finish', reason: 'stop' as const },
                ],
            ]);

            const agent = new ReActAgent({
                provider,
                model: 'test',
                tools: [slowTool],
            });

            const events = await collectEvents(agent, 'Do something slow');

            const toolResponse = events.find(
                (e) => e.type === 'tool_response' && (e as any).toolName === 'slow_tool',
            );
            expect(toolResponse).toBeDefined();
            expect((toolResponse as any).isError).toBe(true);
            expect((toolResponse as any).content).toContain('timed out');

            expect(events[events.length - 1]).toMatchObject({
                type: 'agent_end',
                reason: 'complete',
            });
        });

        it('respects AgentConfig.toolTimeout as default', async () => {
            const slowTool = tool(
                {
                    name: 'slow_tool',
                    description: 'A tool without its own timeout',
                    parameters: z.object({}),
                },
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    return 'done';
                },
            );

            const provider = mockProvider([
                [
                    { type: 'tool_call', id: 'tc1', name: 'slow_tool', args: {} },
                    { type: 'finish', reason: 'tool_calls' as const },
                ],
                [
                    { type: 'text', text: 'Timed out.' },
                    { type: 'finish', reason: 'stop' as const },
                ],
            ]);

            const agent = new ReActAgent({
                provider,
                model: 'test',
                tools: [slowTool],
                toolTimeout: 50,
            });

            const events = await collectEvents(agent, 'Do something');

            const toolResponse = events.find(
                (e) => e.type === 'tool_response' && (e as any).toolName === 'slow_tool',
            );
            expect(toolResponse).toBeDefined();
            expect((toolResponse as any).isError).toBe(true);
            expect((toolResponse as any).content).toContain('timed out');
        });
    });
});

describe('ReActAgent with allowPlanMode', () => {
    it('injects plan mode tools when allowPlanMode is true', async () => {
        const provider = mockProvider([
            [
                { type: 'text', text: 'Done.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        let capturedOptions: any;
        const origChat = provider.chat;
        provider.chat = function (options: any) {
            capturedOptions = options;
            return origChat.call(this, options);
        };

        const agent = new ReActAgent({
            provider,
            model: 'test-model',
            allowPlanMode: true,
        });

        await collectEvents(agent, 'Hello');

        const toolNames = capturedOptions?.tools?.map((t: any) => t.name) ?? [];
        expect(toolNames).toContain('enter_plan_mode');
        expect(toolNames).toContain('exit_plan_mode');
    });

    it('does not inject plan mode tools by default', async () => {
        const provider = mockProvider([
            [
                { type: 'text', text: 'Done.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        let capturedOptions: any;
        const origChat = provider.chat;
        provider.chat = function (options: any) {
            capturedOptions = options;
            return origChat.call(this, options);
        };

        const agent = new ReActAgent({
            provider,
            model: 'test-model',
        });

        await collectEvents(agent, 'Hello');

        expect(capturedOptions?.tools).toBeUndefined();
    });
});

describe('Agent reuse (multiple run() calls)', () => {
    it('should support calling run() multiple times on the same agent instance', async () => {
        const responses = [
            // 第一次 run：直接返回文本
            [{ type: 'text' as const, text: 'First response' }, { type: 'finish' as const }],
            // 第二次 run：也直接返回文本
            [{ type: 'text' as const, text: 'Second response' }, { type: 'finish' as const }],
        ];

        const agent = new ReActAgent({
            provider: mockProvider(responses),
            model: 'test',
        });

        // 第一次运行
        const events1: AgentEvent[] = [];
        for await (const event of agent.run('Hello')) {
            events1.push(event);
        }
        expect(events1.some(e => e.type === 'message' && e.content === 'First response')).toBe(true);
        expect(events1.some(e => e.type === 'agent_end' && e.reason === 'complete')).toBe(true);

        // 第二次运行 — 之前会抛 "Invalid state transition: completed → reacting"
        const events2: AgentEvent[] = [];
        for await (const event of agent.run('Hello again')) {
            events2.push(event);
        }
        expect(events2.some(e => e.type === 'message' && e.content === 'Second response')).toBe(true);
        expect(events2.some(e => e.type === 'agent_end' && e.reason === 'complete')).toBe(true);
    });

    it('should support reuse with tool calls', async () => {
        const responses = [
            // 第一次 run：调用工具后返回
            [
                { type: 'tool_call' as const, id: 'tc1', name: 'echo', args: { text: 'a' } },
                { type: 'finish' as const },
            ],
            [{ type: 'text' as const, text: 'Done first' }, { type: 'finish' as const }],
            // 第二次 run：调用工具后返回
            [
                { type: 'tool_call' as const, id: 'tc2', name: 'echo', args: { text: 'b' } },
                { type: 'finish' as const },
            ],
            [{ type: 'text' as const, text: 'Done second' }, { type: 'finish' as const }],
        ];

        const echoTool = tool(
            { name: 'echo', description: 'Echo', parameters: z.object({ text: z.string() }) },
            async ({ text }) => text,
        );

        const agent = new ReActAgent({
            provider: mockProvider(responses),
            model: 'test',
            tools: [echoTool],
        });

        // 第一次运行
        for await (const _event of agent.run('First')) { /* consume */ }

        // 第二次运行
        const events: AgentEvent[] = [];
        for await (const event of agent.run('Second')) {
            events.push(event);
        }
        expect(events.some(e => e.type === 'message' && e.content === 'Done second')).toBe(true);
    });
});
