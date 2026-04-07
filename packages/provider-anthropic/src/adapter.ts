/**
 * Anthropic 消息格式适配器：agent-tea 归一化格式 ↔ Anthropic API 格式
 *
 * Anthropic API 与 OpenAI 的关键差异：
 * - 工具结果放在 `user` 消息的 `tool_result` 内容块中（而非独立的 tool role）
 * - 工具调用使用 `tool_use` 块，input 直接是 JSON 对象（无需 stringify）
 * - system prompt 是独立的 API 参数，不是消息数组中的一条
 * - 消息交替规则更严格：user 和 assistant 必须严格交替
 *
 * 架构位置：provider-anthropic 包的适配层，被 AnthropicChatSession 使用。
 */

import type { Message, ToolDefinition, ContentPart } from '@agent-tea/core';
import type Anthropic from '@anthropic-ai/sdk';

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicTool = Anthropic.Tool;
type AnthropicContentBlock = Anthropic.ContentBlockParam;

/** 将 agent-tea 归一化消息转为 Anthropic 消息格式 */
export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
        switch (msg.role) {
            case 'user': {
                const content =
                    typeof msg.content === 'string'
                        ? msg.content
                        : msg.content
                              .filter(
                                  (p): p is Extract<ContentPart, { type: 'text' }> =>
                                      p.type === 'text',
                              )
                              .map((p) => p.text)
                              .join('');
                result.push({ role: 'user', content });
                break;
            }

            case 'assistant': {
                // Anthropic 使用 content blocks 数组，text 和 tool_use 混合放置
                const blocks: AnthropicContentBlock[] = [];

                for (const part of msg.content) {
                    if (part.type === 'text' && part.text) {
                        blocks.push({ type: 'text', text: part.text });
                    } else if (part.type === 'tool_call') {
                        // Anthropic 使用 tool_use（不是 function），input 直接是对象
                        blocks.push({
                            type: 'tool_use',
                            id: part.toolCallId,
                            name: part.toolName,
                            input: part.args as Record<string, unknown>,
                        });
                    }
                }

                if (blocks.length > 0) {
                    result.push({ role: 'assistant', content: blocks });
                }
                break;
            }

            case 'tool': {
                // Anthropic 的特殊规则：工具结果放在 user 消息中（而非单独的 tool role）
                // 这是因为 Anthropic 要求消息严格 user/assistant 交替
                const blocks: AnthropicContentBlock[] = msg.content.map((part) => ({
                    type: 'tool_result' as const,
                    tool_use_id: part.toolCallId,
                    content: part.content,
                    is_error: part.isError ?? false,
                }));
                result.push({ role: 'user', content: blocks });
                break;
            }
        }
    }

    return result;
}

/** 将 agent-tea ToolDefinition 转为 Anthropic 工具格式 */
export function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // Anthropic 使用 input_schema 而非 parameters
        input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    }));
}
