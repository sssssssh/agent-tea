/**
 * 上下文管理类型定义
 *
 * 解决的问题：对话越来越长，消息积累超过 LLM 上下文窗口限制时会报错或丢失信息。
 * ContextManager 在每次 LLM 调用前对消息列表进行裁剪，确保不超限。
 *
 * 设计要点：
 * - 接口化设计，支持不同裁剪策略（滑动窗口、摘要、混合）
 * - 非破坏性：裁剪产生新数组，不修改原始消息列表
 * - Token 估算采用简单的字符比率，避免引入 tokenizer 依赖
 *
 * 架构位置：Core 层的 Context 子模块，被 BaseAgent 的 collectResponse 前调用。
 */

import type { Message } from '../llm/types.js';

/**
 * 上下文管理器接口。
 *
 * 在消息发送给 LLM 前进行预处理，确保消息总量在 token 预算内。
 * 实现者可以选择不同的裁剪策略。
 */
export interface ContextManager {
  /**
   * 处理消息列表，返回裁剪后的消息数组。
   * 不修改原始数组，返回新数组。
   */
  prepare(messages: Message[]): Message[];
}

/**
 * 上下文管理器配置。
 * 放在 AgentConfig 中，由 BaseAgent 在初始化时创建对应的 ContextManager。
 */
export interface ContextManagerConfig {
  /**
   * 最大上下文 token 数（粗略估算）。
   * 建议设为模型上下文窗口的 80%，留余量给系统提示和输出。
   */
  maxTokens: number;

  /**
   * 裁剪策略：
   * - 'sliding_window': 保留最近的消息，丢弃最早的（默认）
   */
  strategy?: 'sliding_window';

  /**
   * 始终保留的消息数（从列表头部开始计数）。
   * 用于保护最初的系统/用户消息不被裁剪。
   * 默认为 1（保留第一条用户消息）。
   */
  reservedMessageCount?: number;
}
