/**
 * Anthropic LLM Provider 实现
 *
 * 将 agent-tea 的 LLMProvider 接口适配到 Anthropic Messages API。
 *
 * Anthropic 的流式事件模型与 OpenAI 不同：
 * - 基于 content block 生命周期（start → delta → stop）
 * - 工具调用参数通过 input_json_delta 增量传输
 * - 用量信息分两次到达：message_start 有 input tokens，message_delta 有 output tokens
 * - max_tokens 是必填参数（OpenAI 中是可选的）
 *
 * 架构位置：provider-anthropic 包，实现 Core 层定义的 LLMProvider 接口。
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ChatSession,
  ChatOptions,
  Message,
  ChatStreamEvent,
} from '@agent-tea/core';
import { toAnthropicMessages, toAnthropicTools } from './adapter.js';

export interface AnthropicProviderOptions {
  /** Anthropic API Key（不传则从 ANTHROPIC_API_KEY 环境变量读取） */
  apiKey?: string;
  /** API 基础 URL */
  baseURL?: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  private client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  chat(options: ChatOptions): ChatSession {
    return new AnthropicChatSession(this.client, options);
  }
}

/** Anthropic 聊天会话，基于 content block 生命周期处理流式响应 */
class AnthropicChatSession implements ChatSession {
  constructor(
    private client: Anthropic,
    private options: ChatOptions,
  ) {}

  async *sendMessage(
    messages: Message[],
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const anthropicMessages = toAnthropicMessages(messages);

    const requestParams: Anthropic.MessageCreateParamsStreaming = {
      model: this.options.model,
      messages: anthropicMessages,
      // Anthropic API 要求 max_tokens 必填，默认 4096
      max_tokens: this.options.maxTokens ?? 4096,
      stream: true,
    };

    // Anthropic 的 system prompt 是独立的顶层参数，不在消息数组中
    if (this.options.systemPrompt) {
      requestParams.system = this.options.systemPrompt;
    }

    if (this.options.tools && this.options.tools.length > 0) {
      requestParams.tools = toAnthropicTools(this.options.tools);
    }

    if (this.options.temperature !== undefined) {
      requestParams.temperature = this.options.temperature;
    }

    try {
      const stream = this.client.messages.stream(requestParams, {
        signal,
      });

      // 按 blockIndex 追踪正在构建的工具调用
      // Anthropic 的 content_block_start/delta/stop 通过 index 关联同一个 block
      const pendingToolCalls = new Map<
        number,
        { id: string; name: string; inputJson: string }
      >();
      let blockIndex = 0;

      for await (const event of stream) {
        switch (event.type) {
          // content block 开始 —— 初始化文本块或工具调用块
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'text') {
              // 文本块开始，实际内容在后续 delta 中到达
            } else if (block.type === 'tool_use') {
              // 工具调用块开始，记录 id 和 name，参数在 delta 中累积
              pendingToolCalls.set(blockIndex, {
                id: block.id,
                name: block.name,
                inputJson: '',
              });
            }
            blockIndex++;
            break;
          }

          // content block 增量 —— 文本片段或工具参数 JSON 片段
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'text', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              // 拼接工具参数的 JSON 片段
              const pending = pendingToolCalls.get(event.index);
              if (pending) {
                pending.inputJson += delta.partial_json;
              }
            }
            break;
          }

          // content block 结束 —— 工具调用参数累积完成，可以发出事件
          case 'content_block_stop': {
            const pending = pendingToolCalls.get(event.index);
            if (pending) {
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(pending.inputJson);
              } catch {
                args = { _raw: pending.inputJson };
              }
              yield {
                type: 'tool_call',
                id: pending.id,
                name: pending.name,
                args,
              };
              pendingToolCalls.delete(event.index);
            }
            break;
          }

          // 消息级别的结束事件，包含 stop_reason 和 output token 用量
          case 'message_delta': {
            const stopReason = event.delta.stop_reason;
            yield {
              type: 'finish',
              // Anthropic 用 'tool_use' 表示需要调用工具，映射为框架的 'tool_calls'
              reason: stopReason === 'tool_use' ? 'tool_calls' : 'stop',
              usage: event.usage
                ? {
                    outputTokens: event.usage.output_tokens,
                  }
                : undefined,
            };
            break;
          }

          case 'message_start': {
            // message_start 中包含 input token 用量
            // 当前简化处理，未合并到 finish 事件中（后续可优化）
            if (event.message.usage) {
              // TODO: 将 input tokens 合并到最终的 usage 统计中
            }
            break;
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
