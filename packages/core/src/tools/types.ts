/**
 * Tool 系统类型定义
 *
 * Tool 是 Agent 可以调用的能力单元。通过 LLM 的 function calling 机制，
 * LLM 决定何时调用哪个工具、传什么参数，Agent 循环负责执行并回传结果。
 *
 * 设计要点：
 * - 使用 Zod Schema 做参数定义，兼顾运行时校验和编译时类型推导
 * - ToolContext 提供执行环境信息，避免工具需要全局状态
 * - ToolResult 区分"给 LLM 的内容"和"给用户看的内容"，支持灵活展示
 *
 * 架构位置：Core 层的 Tool 子模块，被 Agent、Scheduler、Builder 依赖。
 */

import type { ZodType } from 'zod';
import type { Message } from '../llm/types.js';

/**
 * 工具执行上下文 —— 通过依赖注入的方式将运行时环境传递给工具。
 * 这样工具就不需要依赖全局变量，也方便测试时 mock。
 */
export interface ToolContext {
  /** 当前会话 ID，可用于日志关联或状态隔离 */
  sessionId: string;
  /** 当前工作目录，文件操作类工具需要用到 */
  cwd: string;
  /** 到目前为止的对话历史（只读），工具可据此理解上下文 */
  messages: readonly Message[];
  /** 取消信号，工具应在长时间操作中检查此信号以支持优雅中断 */
  signal: AbortSignal;
}

/**
 * 工具执行结果。
 * 将"返回给 LLM 的内容"和"展示给用户的内容"分开，
 * 是因为有时候两者差异很大（如返回给 LLM 的是精简 JSON，展示给用户的是格式化表格）。
 */
export interface ToolResult {
  /** 发送给 LLM 的工具响应内容 */
  content: string;
  /** 展示给用户的内容（不传则默认使用 content） */
  displayContent?: string;
  /** 附加结构化数据，供消费方（如 UI）按需使用 */
  data?: Record<string, unknown>;
  /** 标记此结果是否为错误，LLM 会据此调整后续策略 */
  isError?: boolean;
}

/**
 * 工具接口 —— Agent 框架中的能力扩展点。
 *
 * 使用 Zod Schema 而非 JSON Schema 定义参数的原因：
 * 1. 编写时享有 TypeScript 类型推导（TParams 自动推断）
 * 2. 运行时自动校验 LLM 传来的参数（LLM 可能生成不合规的参数）
 * 3. 注册到 ToolRegistry 时再自动转为 JSON Schema 发给 LLM
 *
 * @typeParam TParams - 经过 Zod 验证后的参数类型
 */
export interface Tool<TParams = Record<string, unknown>> {
  /** 唯一工具名，LLM 通过此名称发起调用 */
  readonly name: string;
  /** 工具描述，发送给 LLM 帮助其理解何时使用此工具 */
  readonly description: string;
  /** Zod 参数 Schema，同时用于类型推导和运行时校验 */
  readonly parameters: ZodType<TParams>;
  /** 工具标签，用于分类过滤（如 'readonly' 表示只读工具） */
  readonly tags?: string[];
  /** 执行超时（毫秒），不设置则使用框架默认值（30s） */
  readonly timeout?: number;

  /**
   * 执行工具逻辑。参数已经过 Zod 校验，可安全使用。
   * 返回字符串时会自动包装为 { content: string }，简化简单场景。
   */
  execute(
    params: TParams,
    context: ToolContext,
  ): Promise<ToolResult | string>;
}
