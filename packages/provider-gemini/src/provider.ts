/**
 * Google Gemini LLM Provider 实现
 *
 * 将 agent-tea 的 LLMProvider 接口适配到 Google Gemini generateContent API。
 *
 * Gemini 的流式模型与 OpenAI/Anthropic 的区别：
 * - 工具调用在单个 chunk 中完整到达（不像 OpenAI/Anthropic 需要跨 chunk 拼接）
 * - finishReason 使用枚举字符串或数字（'STOP'/'1', 'MAX_TOKENS'/'2' 等）
 * - 用量信息在 usageMetadata 字段中
 * - API Key 必填，不像 OpenAI SDK 可以自动从环境变量读取
 *
 * 架构位置：provider-gemini 包，实现 Core 层定义的 LLMProvider 接口。
 */

import { GoogleGenAI } from '@google/genai';
import type {
    LLMProvider,
    ChatSession,
    ChatOptions,
    Message,
    ChatStreamEvent,
    FinishReason,
} from '@agent-tea/core';
import { toGeminiContents, toGeminiTools } from './adapter.js';

export interface GeminiProviderOptions {
    /** Gemini API Key（不传则从 GEMINI_API_KEY 环境变量读取） */
    apiKey?: string;
}

export class GeminiProvider implements LLMProvider {
    readonly id = 'gemini';
    private client: GoogleGenAI;

    constructor(options: GeminiProviderOptions = {}) {
        // Gemini SDK 不自动读取环境变量，需要手动处理
        const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is required');
        }
        this.client = new GoogleGenAI({ apiKey });
    }

    chat(options: ChatOptions): ChatSession {
        return new GeminiChatSession(this.client, options);
    }
}

/** Gemini 聊天会话，处理 generateContentStream 的响应 */
class GeminiChatSession implements ChatSession {
    constructor(
        private client: GoogleGenAI,
        private options: ChatOptions,
    ) {}

    async *sendMessage(messages: Message[], signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
        const contents = toGeminiContents(messages);

        try {
            const response = await this.client.models.generateContentStream({
                model: this.options.model,
                contents,
                config: {
                    // Gemini 的 system prompt 通过 config.systemInstruction 设置
                    systemInstruction: this.options.systemPrompt,
                    tools:
                        this.options.tools && this.options.tools.length > 0
                            ? toGeminiTools(this.options.tools)
                            : undefined,
                    temperature: this.options.temperature,
                    maxOutputTokens: this.options.maxTokens,
                },
            });

            let finishReason: FinishReason = 'stop';
            let hasToolCalls = false;
            // 追踪最后一个 usageMetadata，用于在流结束后始终 yield finish 事件
            let lastUsageMetadata: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                totalTokenCount?: number;
            } | null = null;
            for await (const chunk of response) {
                if (signal?.aborted) break;

                const candidate = chunk.candidates?.[0];
                if (!candidate?.content?.parts) {
                    // 即使没有 parts，也可能有 usageMetadata（如最终 chunk）
                    if (chunk.usageMetadata) {
                        lastUsageMetadata = chunk.usageMetadata;
                    }
                    continue;
                }

                for (const part of candidate.content.parts) {
                    if (part.text) {
                        yield { type: 'text', text: part.text };
                    }

                    if (part.functionCall) {
                        hasToolCalls = true;
                        // Gemini 的 functionCall 在单个 chunk 中完整到达，不需要跨 chunk 拼接
                        yield {
                            type: 'tool_call',
                            // Gemini 可能不返回 id，需要自行生成
                            id: part.functionCall.id ?? crypto.randomUUID(),
                            name: part.functionCall.name ?? '',
                            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                        };
                    }
                }

                // Gemini 的 finishReason 可能是字符串枚举或数字，需要兼容处理
                if (candidate.finishReason) {
                    const reason = String(candidate.finishReason);
                    if (reason === 'STOP' || reason === '1') {
                        // STOP 但有工具调用时，实际含义是"需要执行工具"
                        finishReason = hasToolCalls ? 'tool_calls' : 'stop';
                    } else if (reason === 'MAX_TOKENS' || reason === '2') {
                        finishReason = 'length';
                    } else if (reason === 'TOOL_CALLS' || reason === '8') {
                        finishReason = 'tool_calls';
                    }
                }

                if (chunk.usageMetadata) {
                    lastUsageMetadata = chunk.usageMetadata;
                }
            }

            // 始终 yield finish 事件，确保 Agent 循环不会卡死
            yield {
                type: 'finish',
                reason: finishReason,
                usage: lastUsageMetadata
                    ? {
                          inputTokens: lastUsageMetadata.promptTokenCount,
                          outputTokens: lastUsageMetadata.candidatesTokenCount,
                          totalTokens: lastUsageMetadata.totalTokenCount,
                      }
                    : undefined,
            };
        } catch (error) {
            if (error instanceof Error) {
                yield { type: 'error', error };
            } else {
                yield { type: 'error', error: new Error(String(error)) };
            }
        }
    }
}
