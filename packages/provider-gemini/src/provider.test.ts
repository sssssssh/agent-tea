import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatStreamEvent, Message } from '@agent-tea/core';

// ============================================================
// Mock @google/genai
//
// GeminiProvider 内部创建 GoogleGenAI 实例，通过
// client.models.generateContentStream() 获取流式响应。
// 我们 mock 整个模块，让 generateContentStream 返回可控的 async iterable。
// ============================================================

/**
 * 使用稳定对象引用持有 mock 函数，避免 vi.mock 提升导致的闭包问题。
 * vi.mock 工厂在模块加载时执行（早于 let 声明），
 * 通过对象属性间接引用可以在后续 beforeEach 中安全替换。
 */
const mockHolder: { generateContentStream: ReturnType<typeof vi.fn> } = {
    generateContentStream: vi.fn(),
};

vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: vi.fn().mockImplementation(() => ({
            models: {
                generateContentStream: (...args: unknown[]) =>
                    mockHolder.generateContentStream(...args),
            },
        })),
    };
});

// mock 后再 import，确保使用 mock 版本
import { GeminiProvider } from './provider.js';

// ============================================================
// 辅助函数
// ============================================================

/** 构造一个返回给定 chunks 的 async iterable（模拟 Gemini 流式响应） */
function makeStream(chunks: unknown[]) {
    return async function* () {
        for (const chunk of chunks) {
            yield chunk;
        }
    };
}

/** 收集 AsyncGenerator 产出的所有事件 */
async function collectEvents(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
    const events: ChatStreamEvent[] = [];
    for await (const event of gen) {
        events.push(event);
    }
    return events;
}

/** 创建一个使用 mock 的 provider，返回其 ChatSession */
function createSession() {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    return provider.chat({ model: 'gemini-2.0-flash' });
}

const userMessages: Message[] = [{ role: 'user', content: 'Hello' }];

// ============================================================
// 测试
// ============================================================

describe('GeminiProvider', () => {
    beforeEach(() => {
        mockHolder.generateContentStream = vi.fn();
    });

    it('yields text events from stream', async () => {
        const chunks = [
            {
                candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: undefined }],
            },
            {
                candidates: [{ content: { parts: [{ text: ' world' }] }, finishReason: 'STOP' }],
            },
        ];
        mockHolder.generateContentStream.mockReturnValue(makeStream(chunks)());

        const session = createSession();
        const events = await collectEvents(session.sendMessage(userMessages));

        const textEvents = events.filter((e) => e.type === 'text');
        expect(textEvents).toEqual([
            { type: 'text', text: 'Hello' },
            { type: 'text', text: ' world' },
        ]);
    });

    it('yields finish event with usage when usageMetadata is present', async () => {
        const chunks = [
            {
                candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            },
        ];
        mockHolder.generateContentStream.mockReturnValue(makeStream(chunks)());

        const session = createSession();
        const events = await collectEvents(session.sendMessage(userMessages));

        const finishEvent = events.find((e) => e.type === 'finish');
        expect(finishEvent).toEqual({
            type: 'finish',
            reason: 'stop',
            usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
        });
    });

    it('yields finish event without usage when usageMetadata is missing', async () => {
        // 关键回归测试：即使所有 chunk 都没有 usageMetadata，
        // 也必须 yield finish 事件，否则 Agent 循环会因缺少 finish 事件而卡死。
        const chunks = [
            {
                candidates: [
                    {
                        content: { parts: [{ text: 'Response without usage' }] },
                        finishReason: 'STOP',
                    },
                ],
                // 注意：没有 usageMetadata 字段
            },
        ];
        mockHolder.generateContentStream.mockReturnValue(makeStream(chunks)());

        const session = createSession();
        const events = await collectEvents(session.sendMessage(userMessages));

        const finishEvent = events.find((e) => e.type === 'finish');
        expect(finishEvent).toBeDefined();
        expect(finishEvent).toEqual({
            type: 'finish',
            reason: 'stop',
            usage: undefined,
        });
    });

    it('yields tool_call events from functionCall parts', async () => {
        // 使用固定 UUID 以便断言
        const fixedUUID = '00000000-0000-0000-0000-000000000001';
        const uuidSpy = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValue(fixedUUID as `${string}-${string}-${string}-${string}-${string}`);

        const chunks = [
            {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    functionCall: {
                                        name: 'search',
                                        args: { query: 'weather' },
                                        // 没有 id，应该自动生成
                                    },
                                },
                            ],
                        },
                        finishReason: 'STOP',
                    },
                ],
            },
        ];
        mockHolder.generateContentStream.mockReturnValue(makeStream(chunks)());

        const session = createSession();
        const events = await collectEvents(session.sendMessage(userMessages));

        const toolCallEvent = events.find((e) => e.type === 'tool_call');
        expect(toolCallEvent).toEqual({
            type: 'tool_call',
            id: fixedUUID,
            name: 'search',
            args: { query: 'weather' },
        });

        // finish 事件的 reason 应该是 tool_calls（因为有工具调用且 finishReason 是 STOP）
        const finishEvent = events.find((e) => e.type === 'finish');
        expect(finishEvent).toEqual({
            type: 'finish',
            reason: 'tool_calls',
            usage: undefined,
        });

        // 只恢复 randomUUID spy，不影响模块级 vi.mock
        uuidSpy.mockRestore();
    });

    describe('maps finishReason correctly', () => {
        it.each([
            // [Gemini finishReason, 是否有工具调用, 预期 agent-tea FinishReason]
            ['STOP', false, 'stop'],
            ['1', false, 'stop'], // 数字形式的 STOP
            ['STOP', true, 'tool_calls'], // STOP + 工具调用 → tool_calls
            ['MAX_TOKENS', false, 'length'],
            ['2', false, 'length'], // 数字形式的 MAX_TOKENS
            ['TOOL_CALLS', false, 'tool_calls'],
            ['8', false, 'tool_calls'], // 数字形式的 TOOL_CALLS
        ] as const)(
            'Gemini "%s" (hasToolCalls=%s) -> "%s"',
            async (geminiReason, hasToolCalls, expectedReason) => {
                const parts: unknown[] = [{ text: 'test' }];
                if (hasToolCalls) {
                    parts.push({
                        functionCall: {
                            id: 'fc-1',
                            name: 'some_tool',
                            args: {},
                        },
                    });
                }

                const chunks = [
                    {
                        candidates: [
                            {
                                content: { parts },
                                finishReason: geminiReason,
                            },
                        ],
                    },
                ];
                mockHolder.generateContentStream.mockReturnValue(makeStream(chunks)());

                const session = createSession();
                const events = await collectEvents(session.sendMessage(userMessages));

                const finishEvent = events.find((e) => e.type === 'finish');
                expect(finishEvent).toBeDefined();
                expect(finishEvent!.type === 'finish' && finishEvent!.reason).toBe(expectedReason);
            },
        );
    });

    it('yields error event on stream failure', async () => {
        // generateContentStream 本身抛出异常（如 API 鉴权失败、网络错误）
        const streamError = new Error('API rate limit exceeded');
        mockHolder.generateContentStream.mockRejectedValue(streamError);

        const session = createSession();
        const events = await collectEvents(session.sendMessage(userMessages));

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
            type: 'error',
            error: streamError,
        });
    });

    it('yields error event when stream throws mid-iteration', async () => {
        // 模拟流式过程中抛出异常（不是 generateContentStream 本身失败，
        // 而是 async iterable 的迭代过程中出错）
        const streamError = new Error('Connection reset');
        async function* failingStream() {
            yield {
                candidates: [
                    { content: { parts: [{ text: 'partial' }] }, finishReason: undefined },
                ],
            };
            throw streamError;
        }
        mockHolder.generateContentStream.mockReturnValue(failingStream());

        const session = createSession();
        const events = await collectEvents(session.sendMessage(userMessages));

        // 应该先有 text 事件，然后是 error 事件
        expect(events[0]).toEqual({ type: 'text', text: 'partial' });
        expect(events[events.length - 1]).toEqual({ type: 'error', error: streamError });
    });
});
