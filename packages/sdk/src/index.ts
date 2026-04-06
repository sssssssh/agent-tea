/**
 * @t-agent/sdk —— 面向开发者的统一入口
 *
 * 这是使用 t-agent 框架时推荐的导入包。它做了两件事：
 * 1. 重新导出 @t-agent/core 的公共 API（免去开发者同时引用两个包）
 * 2. 提供 SDK 独有的高级抽象：Extension、Skill、SubAgent
 *
 * 同时重新导出 zod 的 z，这样开发者定义工具参数时不需要单独安装 zod。
 *
 * @example
 * ```typescript
 * import { Agent, tool, extension, subAgent, z } from '@t-agent/sdk';
 * import { OpenAIProvider } from '@t-agent/provider-openai';
 *
 * const myTool = tool({
 *   name: 'greet',
 *   description: 'Greet someone',
 *   parameters: z.object({ name: z.string() }),
 * }, async ({ name }) => `Hello, ${name}!`);
 *
 * const agent = new Agent({
 *   provider: new OpenAIProvider(),
 *   model: 'gpt-4o',
 *   tools: [myTool],
 * });
 *
 * for await (const event of agent.run('Greet Alice')) {
 *   if (event.type === 'message') console.log(event.content);
 * }
 * ```
 */

// 重新导出 zod 的 z，方便开发者定义工具参数 Schema
export { z } from 'zod';

// ---- 从 @t-agent/core 重新导出 ----
export {
  Agent,
  BaseAgent,
  ReActAgent,
  PlanAndExecuteAgent,
  AgentStateMachine,
  PlanStore,
  tool,
  ToolRegistry,
  // 审批
  requiresApproval,
  // 上下文
  SlidingWindowContextManager,
  createContextManager,
  // 记忆
  FileConversationStore,
  FileMemoryStore,
  // 错误
  AgentTeaError,
  ProviderError,
  ToolExecutionError,
  ToolValidationError,
  MaxIterationsError,
  retryWithBackoff,
} from '@t-agent/core';

export type {
  LLMProvider,
  ChatSession,
  ChatOptions,
  Message,
  ContentPart,
  ChatStreamEvent,
  FinishReason,
  UsageInfo,
  ToolDefinition,
  Tool,
  ToolContext,
  ToolResult,
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
  AgentConfig,
  ApprovalPolicy,
  ApprovalDecision,
  ContextManager,
  ContextManagerConfig,
  ConversationStore,
  ConversationMetadata,
  MemoryStore,
  MemoryEntry,
  RetryOptions,
} from '@t-agent/core';

// ---- SDK 独有的高级抽象 ----
export { extension } from './extension.js';
export type { Extension } from './extension.js';

export { skill } from './skill.js';
export type { Skill } from './skill.js';

export { subAgent } from './sub-agent.js';
export type { SubAgentConfig } from './sub-agent.js';
