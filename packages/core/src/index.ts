/**
 * @agent-tea/core 公共 API 导出
 *
 * 这是 core 包的唯一出口，严格控制哪些类型和实现暴露给外部。
 * 内部模块（如 Scheduler、Executor）不在此导出，属于实现细节。
 *
 * 导出分为以下几组：
 * 1. LLM 通信层：类型定义 + Provider 接口
 * 2. Tool 系统：类型 + 工厂函数 + 注册表
 * 3. Agent：核心类 + 事件类型
 * 4. 配置和错误处理
 */

// ---- LLM 通信类型和 Provider 接口 ----
export type {
  ContentPart,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  Message,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  ChatStreamEvent,
  TextStreamEvent,
  ToolCallStreamEvent,
  FinishStreamEvent,
  ErrorStreamEvent,
  FinishReason,
  UsageInfo,
  ToolDefinition,
} from './llm/types.js';

export type {
  LLMProvider,
  ChatSession,
  ChatOptions,
} from './llm/provider.js';

// ---- Tool 系统 ----
export type {
  Tool,
  ToolContext,
  ToolResult,
} from './tools/types.js';

export { tool } from './tools/builder.js';
export { ToolRegistry } from './tools/registry.js';

// ---- Agent 核心 ----
export { Agent } from './agent/agent.js';

export type {
  AgentEvent,
  AgentStartEvent,
  AgentEndEvent,
  MessageEvent,
  ToolRequestEvent,
  ToolResponseEvent,
  UsageEvent,
  ErrorEvent,
} from './agent/types.js';

// ---- 配置 ----
export type { AgentConfig } from './config/types.js';

// ---- 错误处理 ----
export {
  AgentTeaError,
  ProviderError,
  ToolExecutionError,
  ToolValidationError,
  MaxIterationsError,
} from './errors/errors.js';

export { retryWithBackoff } from './errors/retry.js';
export type { RetryOptions } from './errors/retry.js';
