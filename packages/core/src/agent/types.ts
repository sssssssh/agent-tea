/**
 * AgentEvent 事件类型定义
 *
 * 这些事件构成了 Agent 框架与外部消费者（CLI、Web UI、SDK 用户）之间的公共 API 边界。
 *
 * 设计为可区分联合（discriminated union by `type`），消费者可以用 switch/case 精确处理
 * 每种事件，享有 TypeScript 的穷尽检查（exhaustive check）保护。
 *
 * 事件粒度的设计原则：
 * - 足够细：消费者能实现任意 UI 效果（如显示工具调用进度、token 用量等）
 * - 不过细：不暴露内部实现细节（如流式 chunk），保持 API 稳定
 *
 * 架构位置：Core 层的 Agent 子模块，是框架对外的事件契约。
 */

import type { UsageInfo } from '../llm/types.js';

// ============================================================
// Agent 生命周期事件
// ============================================================

/** Agent 开始运行，携带唯一 sessionId 用于日志关联 */
export interface AgentStartEvent {
  type: 'agent_start';
  sessionId: string;
}

/** Agent 运行结束，reason 区分正常完成、出错和被取消三种情况 */
export interface AgentEndEvent {
  type: 'agent_end';
  sessionId: string;
  reason: 'complete' | 'error' | 'abort';
}

// ============================================================
// 内容事件
// ============================================================

/** 消息事件 —— 用户输入或助手回复的文本内容 */
export interface MessageEvent {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
}

// ============================================================
// 工具调用事件
// 拆分为 request/response 两个事件，使消费者可以：
// - 在工具执行前显示"正在调用 xxx..."
// - 在工具执行后显示结果或错误
// ============================================================

/** LLM 发起工具调用（执行前） */
export interface ToolRequestEvent {
  type: 'tool_request';
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** 工具执行完毕（执行后） */
export interface ToolResponseEvent {
  type: 'tool_response';
  requestId: string;
  toolName: string;
  content: string;
  isError?: boolean;
}

// ============================================================
// 元信息事件
// ============================================================

/** Token 用量统计，用于成本监控或 UI 展示 */
export interface UsageEvent {
  type: 'usage';
  model: string;
  usage: UsageInfo;
}

/**
 * 错误事件。
 * fatal=false 的错误不会终止 Agent（如单个工具执行失败），
 * fatal=true 的错误会导致 Agent 停止并发出 AgentEndEvent。
 */
export interface ErrorEvent {
  type: 'error';
  message: string;
  fatal: boolean;
  error?: Error;
}

/** 所有事件的可区分联合 */
export type AgentEvent =
  | AgentStartEvent
  | AgentEndEvent
  | MessageEvent
  | ToolRequestEvent
  | ToolResponseEvent
  | UsageEvent
  | ErrorEvent;
