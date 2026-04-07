/**
 * OpenAI LLM Provider 实现
 *
 * 将 agent-tea 的 LLMProvider 接口适配到 OpenAI 的 Chat Completions API。
 * 支持通过 baseURL 接入 OpenAI 兼容服务（如 Azure OpenAI、本地模型）。
 *
 * 流式处理的复杂性主要来自 OpenAI 的增量传输机制：
 * - 工具调用的参数 JSON 会分散在多个 chunk 中，需要累积拼接
 * - 用量信息在最后一个独立 chunk 中（通过 stream_options 启用）
 *
 * 架构位置：provider-openai 包，实现 Core 层定义的 LLMProvider 接口。
 */

import OpenAI from 'openai';
import type {
    LLMProvider,
    ChatSession,
    ChatOptions,
    Message,
    ChatStreamEvent,
} from '@agent-tea/core';
import { toOpenAIMessages, toOpenAITools } from './adapter.js';

export interface OpenAIProviderOptions {
    /** OpenAI API Key（不传则从 OPENAI_API_KEY 环境变量读取） */
    apiKey?: string;
    /** API 基础 URL，用于接入兼容服务（Azure、本地模型等） */
    baseURL?: string;
    /** 默认请求头 */
    defaultHeaders?: Record<string, string>;
}

export class OpenAIProvider implements LLMProvider {
    readonly id = 'openai';
    private client: OpenAI;

    constructor(options: OpenAIProviderOptions = {}) {
        this.client = new OpenAI({
            apiKey: options.apiKey,
            baseURL: options.baseURL,
            defaultHeaders: options.defaultHeaders,
        });
    }

    chat(options: ChatOptions): ChatSession {
        return new OpenAIChatSession(this.client, options);
    }
}

/** OpenAI 聊天会话，处理流式响应的组装逻辑 */
class OpenAIChatSession implements ChatSession {
    constructor(
        private client: OpenAI,
        private options: ChatOptions,
    ) {}

    async *sendMessage(messages: Message[], signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
        const oaiMessages = toOpenAIMessages(messages);

        // OpenAI 的 system prompt 作为消息数组的第一条 system 消息
        if (this.options.systemPrompt) {
            oaiMessages.unshift({
                role: 'system',
                content: this.options.systemPrompt,
            });
        }

        const requestParams: OpenAI.ChatCompletionCreateParamsStreaming = {
            model: this.options.model,
            messages: oaiMessages,
            stream: true,
            // 启用 include_usage 以在流的最后一个 chunk 中获取 token 用量
            stream_options: { include_usage: true },
        };

        if (this.options.tools && this.options.tools.length > 0) {
            requestParams.tools = toOpenAITools(this.options.tools);
        }
        if (this.options.temperature !== undefined) {
            requestParams.temperature = this.options.temperature;
        }
        if (this.options.maxTokens !== undefined) {
            requestParams.max_tokens = this.options.maxTokens;
        }

        try {
            const stream = await this.client.chat.completions.create(requestParams, {
                signal,
            });

            // 工具调用在流中是增量到达的（参数 JSON 分多个 chunk），
            // 需要按 index 累积，直到收到 finish_reason 时才组装完成
            const pendingToolCalls = new Map<
                number,
                { id: string; name: string; argsJson: string }
            >();

            for await (const chunk of stream) {
                const choice = chunk.choices[0];
                if (!choice) {
                    // 无 choice 的 chunk 是 stream_options 触发的纯用量信息
                    if (chunk.usage) {
                        yield {
                            type: 'finish',
                            reason: 'stop',
                            usage: {
                                inputTokens: chunk.usage.prompt_tokens,
                                outputTokens: chunk.usage.completion_tokens,
                                totalTokens: chunk.usage.total_tokens,
                            },
                        };
                    }
                    continue;
                }

                const delta = choice.delta;

                // 文本增量
                if (delta.content) {
                    yield { type: 'text', text: delta.content };
                }

                // 工具调用增量 —— 参数 JSON 可能分散在多个 chunk 中
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const existing = pendingToolCalls.get(tc.index);
                        if (!existing) {
                            // 首次出现，创建新的待完成调用
                            pendingToolCalls.set(tc.index, {
                                id: tc.id ?? '',
                                name: tc.function?.name ?? '',
                                argsJson: tc.function?.arguments ?? '',
                            });
                        } else {
                            // 后续 chunk，拼接参数 JSON 片段
                            if (tc.function?.arguments) {
                                existing.argsJson += tc.function.arguments;
                            }
                        }
                    }
                }

                // 收到 finish_reason 表示这轮响应结束
                if (choice.finish_reason) {
                    // 将累积完成的工具调用逐个发出
                    for (const [, tc] of pendingToolCalls) {
                        let args: Record<string, unknown> = {};
                        try {
                            args = JSON.parse(tc.argsJson);
                        } catch {
                            // LLM 生成了无效 JSON，保留原始字符串供调试
                            args = { _raw: tc.argsJson };
                        }

                        yield {
                            type: 'tool_call',
                            id: tc.id,
                            name: tc.name,
                            args,
                        };
                    }

                    // 如果没有 usage chunk（stream_options 未生效），在这里发出 finish
                    if (!chunk.usage) {
                        yield {
                            type: 'finish',
                            reason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
                        };
                    }
                }
            }
        } catch (error) {
            if (error instanceof Error) {
                yield { type: 'error', error };
            } else {
                yield { type: 'error', error: new Error(String(error)) };
            }
        }
    }
}
