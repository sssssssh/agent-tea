/**
 * OpenAI 消息格式适配器：t-agent 归一化格式 ↔ OpenAI API 格式
 *
 * OpenAI 的消息格式特点：
 * - assistant 消息的 tool_calls 是独立字段（不在 content 中）
 * - tool_calls 的 args 是 JSON 字符串（需要 stringify/parse）
 * - 工具结果用独立的 tool role 消息，每个结果一条消息
 * - system prompt 作为 role='system' 的消息
 *
 * 架构位置：provider-openai 包的适配层，被 OpenAIChatSession 使用。
 */

import type {
  Message,
  ToolDefinition,
  ContentPart,
} from '@t-agent/core';
import type OpenAI from 'openai';

type OaiMessage = OpenAI.ChatCompletionMessageParam;
type OaiTool = OpenAI.ChatCompletionTool;

/** 将 t-agent 归一化消息转为 OpenAI 消息格式 */
export function toOpenAIMessages(messages: Message[]): OaiMessage[] {
  const result: OaiMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user': {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
              .map((p) => p.text)
              .join('');
        result.push({ role: 'user', content });
        break;
      }

      case 'assistant': {
        // OpenAI 要求文本和工具调用分开放：content 放文本，tool_calls 放调用
        const textParts = msg.content.filter(
          (p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text',
        );
        const toolCallParts = msg.content.filter(
          (p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call',
        );

        const oaiMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: textParts.map((p) => p.text).join('') || null,
        };

        if (toolCallParts.length > 0) {
          // OpenAI 要求 args 序列化为 JSON 字符串
          oaiMsg.tool_calls = toolCallParts.map((tc) => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: {
              name: tc.toolName,
              arguments: JSON.stringify(tc.args),
            },
          }));
        }

        result.push(oaiMsg);
        break;
      }

      case 'tool': {
        // OpenAI 要求每个工具结果作为单独的 tool 消息发送
        for (const part of msg.content) {
          result.push({
            role: 'tool',
            tool_call_id: part.toolCallId,
            content: part.content,
          });
        }
        break;
      }
    }
  }

  return result;
}

/** 将 t-agent ToolDefinition 转为 OpenAI 的 function calling 格式 */
export function toOpenAITools(tools: ToolDefinition[]): OaiTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
