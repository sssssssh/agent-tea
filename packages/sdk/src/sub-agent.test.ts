import { describe, it, expect } from 'vitest';
import { subAgent } from './sub-agent.js';
import { ReActAgent, tool } from '@agent-tea/core';
import { z } from 'zod';
import type { LLMProvider, ChatOptions, ChatSession } from '@agent-tea/core';
import type { Message, ChatStreamEvent } from '@agent-tea/core';
import type { AgentEvent } from '@agent-tea/core';

// --- Mock LLM Provider ---

/**
 * 创建 mock provider，按顺序返回预编排的响应序列。
 * 每个响应是一组 ChatStreamEvent，对应一次 LLM 调用。
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

/** 收集 agent.run() 产出的所有事件 */
async function collectEvents(agent: ReActAgent, input: string): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    for await (const event of agent.run(input)) {
        events.push(event);
    }
    return events;
}

describe('subAgent', () => {
    it('should be callable multiple times by parent agent', async () => {
        // 子 Agent 的 mock provider：两次调用各返回一条文本
        const childProvider = mockProvider([
            // 第一次子 Agent 调用
            [
                { type: 'text', text: 'Research result 1' },
                { type: 'finish', reason: 'stop' },
            ],
            // 第二次子 Agent 调用
            [
                { type: 'text', text: 'Research result 2' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        // 创建 SubAgent 工具
        const researcher = subAgent({
            name: 'researcher',
            description: 'Research a topic',
            provider: childProvider,
            model: 'test-child',
        });

        // 父 Agent 的 mock provider：先调用 SubAgent 两次，再返回最终文本
        const parentProvider = mockProvider([
            // 第一轮：父 LLM 调用 SubAgent（第一次）
            [
                {
                    type: 'tool_call',
                    id: 'tc1',
                    name: 'researcher',
                    args: { task: 'Research topic A' },
                },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // 第二轮：父 LLM 调用 SubAgent（第二次）
            [
                {
                    type: 'tool_call',
                    id: 'tc2',
                    name: 'researcher',
                    args: { task: 'Research topic B' },
                },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // 第三轮：父 LLM 输出最终文本
            [
                { type: 'text', text: 'Combined results from both researches.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const parentAgent = new ReActAgent({
            provider: parentProvider,
            model: 'test-parent',
            tools: [researcher],
        });

        const events = await collectEvents(parentAgent, 'Research two topics');

        // 验证两次 SubAgent 工具调用都有 tool_response 事件
        const toolResponses = events.filter(
            (e) => e.type === 'tool_response' && (e as any).toolName === 'researcher',
        );
        expect(toolResponses).toHaveLength(2);

        // 两次调用都应成功返回（非错误）
        expect((toolResponses[0] as any).isError).toBeFalsy();
        expect((toolResponses[1] as any).isError).toBeFalsy();

        // 两次调用结果应包含子 Agent 的响应内容
        expect((toolResponses[0] as any).content).toContain('Research result 1');
        expect((toolResponses[1] as any).content).toContain('Research result 2');

        // 验证父 Agent 正常结束
        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'complete',
        });
    });

    it('should handle SubAgent with tool calls on multiple invocations', async () => {
        // 子 Agent 有自己的工具
        const lookupTool = tool(
            {
                name: 'lookup',
                description: 'Look up information',
                parameters: z.object({ query: z.string() }),
            },
            async ({ query }) => `Info about: ${query}`,
        );

        // 子 Agent 的 mock provider：每次调用先使用工具再返回文本
        const childProvider = mockProvider([
            // 第一次子 Agent 调用 —— 第一轮：使用 lookup 工具
            [
                { type: 'tool_call', id: 'child-tc1', name: 'lookup', args: { query: 'cats' } },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // 第一次子 Agent 调用 —— 第二轮：返回文本
            [
                { type: 'text', text: 'Cats are great pets.' },
                { type: 'finish', reason: 'stop' },
            ],
            // 第二次子 Agent 调用 —— 第一轮：使用 lookup 工具
            [
                { type: 'tool_call', id: 'child-tc2', name: 'lookup', args: { query: 'dogs' } },
                { type: 'finish', reason: 'tool_calls' },
            ],
            // 第二次子 Agent 调用 —— 第二轮：返回文本
            [
                { type: 'text', text: 'Dogs are loyal companions.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const researcher = subAgent({
            name: 'researcher',
            description: 'Research a topic',
            provider: childProvider,
            model: 'test-child',
            tools: [lookupTool],
        });

        // 父 Agent 的 mock provider
        const parentProvider = mockProvider([
            [
                {
                    type: 'tool_call',
                    id: 'tc1',
                    name: 'researcher',
                    args: { task: 'Tell me about cats' },
                },
                { type: 'finish', reason: 'tool_calls' },
            ],
            [
                {
                    type: 'tool_call',
                    id: 'tc2',
                    name: 'researcher',
                    args: { task: 'Tell me about dogs' },
                },
                { type: 'finish', reason: 'tool_calls' },
            ],
            [
                { type: 'text', text: 'Here is what I found about cats and dogs.' },
                { type: 'finish', reason: 'stop' },
            ],
        ]);

        const parentAgent = new ReActAgent({
            provider: parentProvider,
            model: 'test-parent',
            tools: [researcher],
        });

        const events = await collectEvents(parentAgent, 'Research cats and dogs');

        const toolResponses = events.filter(
            (e) => e.type === 'tool_response' && (e as any).toolName === 'researcher',
        );
        expect(toolResponses).toHaveLength(2);

        // 子 Agent 使用工具后返回的结果
        expect((toolResponses[0] as any).isError).toBeFalsy();
        expect((toolResponses[0] as any).content).toContain('Cats are great pets.');
        expect((toolResponses[1] as any).isError).toBeFalsy();
        expect((toolResponses[1] as any).content).toContain('Dogs are loyal companions.');

        expect(events[events.length - 1]).toMatchObject({
            type: 'agent_end',
            reason: 'complete',
        });
    });
});
