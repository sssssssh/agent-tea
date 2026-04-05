/**
 * LLM Provider 抽象层
 *
 * 采用 Provider + Session 的两层抽象：
 * - LLMProvider：工厂角色，持有 API 客户端等重量级资源，负责创建 Session
 * - ChatSession：轻量级会话对象，绑定了具体的 model/tools/prompt 配置
 *
 * 这种分离使得同一个 Provider 实例可以创建多个不同配置的 Session，
 * 例如主 Agent 和 Sub-Agent 可以共用一个 Provider 但用不同的 model。
 *
 * 架构位置：Core 层的 LLM 子模块，被 Agent 直接使用。
 */

import type {
  ChatStreamEvent,
  Message,
  ToolDefinition,
} from './types.js';

/**
 * 创建 ChatSession 时的选项。
 * 这些参数在 Session 生命周期内保持不变，
 * 避免每次 sendMessage 都重复传递相同配置。
 */
export interface ChatOptions {
  model: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM 聊天会话。
 * 由 LLMProvider.chat() 创建，绑定了特定的模型和工具配置。
 * 采用 AsyncGenerator 返回流式事件，使调用方可以逐步处理响应。
 */
export interface ChatSession {
  /**
   * 发送消息并获取流式响应。
   * signal 用于支持取消操作（如用户主动中断）。
   */
  sendMessage(
    messages: Message[],
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent>;
}

/**
 * LLM Provider 接口 —— 接入新 LLM 厂商只需实现此接口。
 *
 * 设计为无状态工厂：Provider 本身不持有会话状态，
 * 所有有状态的交互都封装在 ChatSession 中。
 *
 * @example
 * ```typescript
 * class OpenAIProvider implements LLMProvider {
 *   readonly id = 'openai';
 *   chat(options: ChatOptions): ChatSession {
 *     return new OpenAIChatSession(this.client, options);
 *   }
 * }
 * ```
 */
export interface LLMProvider {
  /** Provider 唯一标识，用于日志和调试 */
  readonly id: string;

  /** 创建一个绑定了指定配置的聊天会话 */
  chat(options: ChatOptions): ChatSession;
}
