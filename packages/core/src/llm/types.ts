/**
 * LLM 通信类型定义
 *
 * 这是整个框架的统一消息格式层。设计目标是让上层代码（Agent、Scheduler）
 * 不需要关心底层用的是 OpenAI、Anthropic 还是 Gemini —— 各 Provider 的
 * Adapter 负责在这些归一化类型和厂商 API 格式之间做转换。
 *
 * 架构位置：Core 层最底部，被几乎所有其他模块依赖。
 */

// ============================================================
// 内容片段（Content Parts）
// 采用可区分联合（discriminated union），使 Agent 循环中可以用
// type 字段精确匹配不同类型的内容块。
// ============================================================

/** 纯文本片段 —— LLM 生成的自然语言内容 */
export interface TextPart {
  type: 'text';
  text: string;
}

/** 工具调用片段 —— LLM 发出的"请调用某个工具"指令 */
export interface ToolCallPart {
  type: 'tool_call';
  /** 由 LLM 分配的唯一 ID，用于将工具结果关联回对应的调用 */
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** 工具执行结果片段 —— 工具执行完毕后反馈给 LLM 的内容 */
export interface ToolResultPart {
  type: 'tool_result';
  /** 对应 ToolCallPart 的 toolCallId，LLM 据此匹配调用与结果 */
  toolCallId: string;
  content: string;
  isError?: boolean;
}

/** 所有内容片段的联合类型 */
export type ContentPart = TextPart | ToolCallPart | ToolResultPart;

// ============================================================
// 消息（Messages）
// 三种角色对应 Agent 循环中的三个参与方：用户、助手、工具。
// 这种分层使得消息历史可以完整记录整个"对话 → 工具调用 → 结果回传"的过程。
// ============================================================

/** 用户消息 —— content 支持纯字符串（简单场景）和 ContentPart[]（多模态场景） */
export interface UserMessage {
  role: 'user';
  content: string | ContentPart[];
}

/** 助手消息 —— 始终使用 ContentPart[]，因为助手可能同时输出文本和工具调用 */
export interface AssistantMessage {
  role: 'assistant';
  content: ContentPart[];
}

/** 工具消息 —— 一轮中可能有多个工具并行执行，所以 content 是数组 */
export interface ToolMessage {
  role: 'tool';
  content: ToolResultPart[];
}

/** 消息的可区分联合类型，通过 role 字段区分 */
export type Message = UserMessage | AssistantMessage | ToolMessage;

// ============================================================
// 流式事件（Streaming Events）
// LLM Provider 通过 AsyncGenerator 逐块产出这些事件，
// 使 Agent 能在完整响应到达之前就开始处理（如实时显示文本）。
// ============================================================

/** 文本增量事件 —— 每次 yield 一段新增文本 */
export interface TextStreamEvent {
  type: 'text';
  text: string;
}

/** 工具调用事件 —— 流结束后由 Adapter 组装完整参数后发出 */
export interface ToolCallStreamEvent {
  type: 'tool_call';
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** 结束事件 —— 包含结束原因和可选的 token 用量统计 */
export interface FinishStreamEvent {
  type: 'finish';
  reason: FinishReason;
  usage?: UsageInfo;
}

/** 错误事件 —— Provider 通信失败时发出，由 Agent 循环统一处理 */
export interface ErrorStreamEvent {
  type: 'error';
  error: Error;
}

/** 流式事件的可区分联合 */
export type ChatStreamEvent =
  | TextStreamEvent
  | ToolCallStreamEvent
  | FinishStreamEvent
  | ErrorStreamEvent;

// ============================================================
// 辅助类型
// ============================================================

/**
 * LLM 响应结束的原因：
 * - stop: 正常结束
 * - tool_calls: LLM 请求调用工具（Agent 循环需要继续）
 * - length: 达到 token 上限（可能需要截断处理）
 * - error: 出错
 */
export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

/** Token 用量统计，用于成本监控和调试 */
export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * 发送给 LLM 的工具定义。
 * parameters 使用 JSON Schema 格式，由 ToolRegistry 从 Zod Schema 自动转换而来。
 * 这样上层定义工具时用 Zod 享受类型安全，传给 LLM 时用标准 JSON Schema。
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}
