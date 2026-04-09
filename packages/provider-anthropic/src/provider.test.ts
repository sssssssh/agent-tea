import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatStreamEvent, ChatOptions } from '@agent-tea/core';

// ---------- mock helpers ----------

/** 构造一个可异步迭代的 mock stream，模拟 Anthropic SDK 的 messages.stream() 返回值 */
function createMockStream(events: Record<string, unknown>[]) {
    return {
        async *[Symbol.asyncIterator]() {
            for (const event of events) {
                yield event;
            }
        },
    };
}

let mockStream: ReturnType<typeof createMockStream>;

vi.mock('@anthropic-ai/sdk', () => ({
    default: class MockAnthropic {
        messages = {
            stream: () => mockStream,
        };
    },
}));

// 在 vi.mock 之后动态导入，确保拿到 mock 版本
const { AnthropicProvider } = await import('./provider.js');

// ---------- helpers ----------

/** 收集 AsyncGenerator 中所有事件 */
async function collectEvents(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
    const events: ChatStreamEvent[] = [];
    for await (const event of gen) {
        events.push(event);
    }
    return events;
}

const defaultOptions: ChatOptions = {
    model: 'claude-sonnet-4-20250514',
};

describe('AnthropicProvider', () => {
    let provider: InstanceType<typeof AnthropicProvider>;

    beforeEach(() => {
        provider = new AnthropicProvider({ apiKey: 'test-key' });
    });

    it('yields text events from content_block_delta', async () => {
        mockStream = createMockStream([
            { type: 'message_start', message: { usage: { input_tokens: 10 } } },
            { type: 'content_block_start', content_block: { type: 'text' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: ' world' },
            },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { output_tokens: 5 },
            },
        ]);

        const session = provider.chat(defaultOptions);
        const events = await collectEvents(session.sendMessage([{ role: 'user', content: 'Hi' }]));

        const textEvents = events.filter((e) => e.type === 'text');
        expect(textEvents).toHaveLength(2);
        expect(textEvents[0]).toEqual({ type: 'text', text: 'Hello' });
        expect(textEvents[1]).toEqual({ type: 'text', text: ' world' });
    });

    it('yields tool_call events after content_block_stop', async () => {
        mockStream = createMockStream([
            { type: 'message_start', message: { usage: { input_tokens: 20 } } },
            {
                type: 'content_block_start',
                content_block: { type: 'tool_use', id: 'call_1', name: 'search' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"query":' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '"weather"}' },
            },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'tool_use' },
                usage: { output_tokens: 15 },
            },
        ]);

        const session = provider.chat(defaultOptions);
        const events = await collectEvents(session.sendMessage([{ role: 'user', content: 'Hi' }]));

        const toolCallEvents = events.filter((e) => e.type === 'tool_call');
        expect(toolCallEvents).toHaveLength(1);
        expect(toolCallEvents[0]).toEqual({
            type: 'tool_call',
            id: 'call_1',
            name: 'search',
            args: { query: 'weather' },
        });
    });

    it('includes both inputTokens and outputTokens in finish event', async () => {
        // 回归测试：确保 message_start 中的 input_tokens 被保留并合并到 finish 事件
        mockStream = createMockStream([
            { type: 'message_start', message: { usage: { input_tokens: 100 } } },
            { type: 'content_block_start', content_block: { type: 'text' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { output_tokens: 42 },
            },
        ]);

        const session = provider.chat(defaultOptions);
        const events = await collectEvents(session.sendMessage([{ role: 'user', content: 'Hi' }]));

        const finishEvent = events.find((e) => e.type === 'finish');
        expect(finishEvent).toBeDefined();
        expect(finishEvent!.type).toBe('finish');

        // 类型收窄后检查 usage 字段
        if (finishEvent!.type === 'finish') {
            expect(finishEvent!.usage).toEqual({
                inputTokens: 100,
                outputTokens: 42,
                totalTokens: 142,
            });
        }
    });

    it('handles finish event when only outputTokens available', async () => {
        // message_start 不携带 usage 时，finish 事件中只有 outputTokens
        mockStream = createMockStream([
            { type: 'message_start', message: {} },
            { type: 'content_block_start', content_block: { type: 'text' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { output_tokens: 10 },
            },
        ]);

        const session = provider.chat(defaultOptions);
        const events = await collectEvents(session.sendMessage([{ role: 'user', content: 'Hi' }]));

        const finishEvent = events.find((e) => e.type === 'finish');
        expect(finishEvent).toBeDefined();

        if (finishEvent!.type === 'finish') {
            expect(finishEvent!.usage).toEqual({
                inputTokens: undefined,
                outputTokens: 10,
                totalTokens: 10,
            });
        }
    });

    it('maps stop_reason tool_use to tool_calls', async () => {
        mockStream = createMockStream([
            { type: 'message_start', message: { usage: { input_tokens: 50 } } },
            {
                type: 'content_block_start',
                content_block: { type: 'tool_use', id: 'call_2', name: 'read_file' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' },
            },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'tool_use' },
                usage: { output_tokens: 30 },
            },
        ]);

        const session = provider.chat(defaultOptions);
        const events = await collectEvents(session.sendMessage([{ role: 'user', content: 'Hi' }]));

        const finishEvent = events.find((e) => e.type === 'finish');
        expect(finishEvent).toBeDefined();

        if (finishEvent!.type === 'finish') {
            // 'tool_use' 应被映射为框架统一的 'tool_calls'
            expect(finishEvent!.reason).toBe('tool_calls');
        }
    });

    it('yields error event on stream failure', async () => {
        // 模拟 stream 迭代过程中抛出异常
        const streamError = new Error('Connection reset');
        mockStream = {
            async *[Symbol.asyncIterator]() {
                throw streamError;
            },
        } as ReturnType<typeof createMockStream>;

        const session = provider.chat(defaultOptions);
        const events = await collectEvents(session.sendMessage([{ role: 'user', content: 'Hi' }]));

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('error');

        if (events[0].type === 'error') {
            expect(events[0].error).toBe(streamError);
            expect(events[0].error.message).toBe('Connection reset');
        }
    });
});
