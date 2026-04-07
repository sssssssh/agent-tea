/**
 * @t-agent/core 公共 API 导出
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

// ---- 内置工具 ----
export {
  readFile,
  writeFile,
  listDirectory,
  executeShell,
  grep,
  webFetch,
} from './tools/builtin/index.js';

// ---- Agent 核心 ----
export { Agent } from './agent/agent.js';
export { BaseAgent } from './agent/base-agent.js';
export { ReActAgent } from './agent/react-agent.js';
export { PlanAndExecuteAgent } from './agent/plan-and-execute-agent.js';
export { AgentStateMachine } from './agent/state-machine.js';
export { PlanStore } from './agent/plan-store.js';

export type {
  AgentEvent,
  AgentStartEvent,
  AgentEndEvent,
  MessageEvent,
  ToolRequestEvent,
  ToolResponseEvent,
  UsageEvent,
  ErrorEvent,
  StateChangeEvent,
  ApprovalRequestEvent,
  PlanCreatedEvent,
  StepStartEvent,
  StepCompleteEvent,
  StepFailedEvent,
  ExecutionPausedEvent,
  AgentState,
  StateTransition,
  Plan,
  PlanStep,
  StepResult,
  PlanApproval,
  StepFailureAction,
  IterationContext,
  ToolCallDecision,
  CollectedResponse,
  ToolCallInfo,
} from './agent/types.js';

// ---- 配置 ----
export type { AgentConfig } from './config/types.js';

// ---- 审批系统 ----
export type {
  ApprovalPolicy,
  ApprovalDecision,
} from './approval/types.js';

export { requiresApproval } from './approval/policy.js';

// ---- 上下文管理 ----
export type {
  ContextManager,
  ContextManagerConfig,
  ContextProcessor,
  TokenBudget,
} from './context/types.js';

export {
  SlidingWindowContextManager,
  createContextManager,
} from './context/sliding-window.js';

export { PipelineContextManager } from './context/pipeline.js';
export { SlidingWindowProcessor } from './context/processors/sliding-window.js';
export { ToolOutputTruncator } from './context/processors/tool-output-truncator.js';
export { MessageCompressor } from './context/processors/message-compressor.js';

// ---- 记忆持久化 ----
export type {
  ConversationStore,
  ConversationMetadata,
  MemoryStore,
  MemoryEntry,
} from './memory/types.js';

export { FileConversationStore } from './memory/file-conversation-store.js';
export { FileMemoryStore } from './memory/file-memory-store.js';

// ---- 循环检测 ----
export { LoopDetector, DEFAULT_LOOP_DETECTION_CONFIG } from './agent/loop-detection.js';
export type { LoopDetectionConfig, LoopCheckResult } from './agent/loop-detection.js';

// ---- 错误处理 ----
export {
  AgentTeaError,
  ProviderError,
  ToolExecutionError,
  ToolValidationError,
  MaxIterationsError,
  LoopDetectedError,
  TimeoutError,
} from './errors/errors.js';

export { retryWithBackoff } from './errors/retry.js';
export type { RetryOptions } from './errors/retry.js';
