/**
 * Google Gemini 消息格式适配器：t-agent 归一化格式 ↔ Gemini API 格式
 *
 * Gemini API 与 OpenAI/Anthropic 的关键差异：
 * - 消息是 Content 对象，角色只有 'user' | 'model'（没有 assistant/tool/system）
 * - 内容使用 parts 数组，包含 text/functionCall/functionResponse 等联合类型
 * - 工具调用用 functionCall part，工具结果用 functionResponse part（放在 user Content 中）
 * - 所有函数声明包装在一个 Tool 对象的 functionDeclarations 数组中
 * - system prompt 通过 config.systemInstruction 传递
 *
 * 架构位置：provider-gemini 包的适配层，被 GeminiChatSession 使用。
 */

import type {
  Message,
  ToolDefinition,
  ContentPart,
} from '@t-agent/core';
import type {
  Content,
  Part,
  FunctionDeclaration,
  Tool as GeminiTool,
} from '@google/genai';

/** 将 t-agent 归一化消息转为 Gemini Content 格式 */
export function toGeminiContents(messages: Message[]): Content[] {
  const result: Content[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user': {
        const text = typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
              .map((p) => p.text)
              .join('');
        result.push({
          role: 'user',
          parts: [{ text }],
        });
        break;
      }

      case 'assistant': {
        // Gemini 的助手角色叫 'model'
        const parts: Part[] = [];

        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            parts.push({ text: part.text });
          } else if (part.type === 'tool_call') {
            // Gemini 使用 functionCall 而非 tool_use/function
            parts.push({
              functionCall: {
                name: part.toolName,
                id: part.toolCallId,
                args: part.args as Record<string, unknown>,
              },
            });
          }
        }

        if (parts.length > 0) {
          result.push({ role: 'model', parts });
        }
        break;
      }

      case 'tool': {
        // Gemini 的工具结果放在 user Content 的 functionResponse parts 中
        const parts: Part[] = msg.content.map((part) => ({
          functionResponse: {
            name: '', // Gemini SDK 会从原始调用中自动匹配 name
            id: part.toolCallId,
            response: { result: part.content },
          },
        }));
        result.push({ role: 'user', parts });
        break;
      }
    }
  }

  return result;
}

/** 将 t-agent ToolDefinition 转为 Gemini 工具格式 */
export function toGeminiTools(tools: ToolDefinition[]): GeminiTool[] {
  const declarations: FunctionDeclaration[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as FunctionDeclaration['parameters'],
  }));

  // Gemini 的特殊结构：所有函数声明包装在一个 Tool 对象中（而非每个函数一个 Tool）
  return [{ functionDeclarations: declarations }];
}
