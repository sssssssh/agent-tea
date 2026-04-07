/**
 * ToolExecutor —— 工具执行器
 *
 * 职责：接收单个工具调用请求，完成"参数校验 → 执行 → 错误处理"的完整流程。
 *
 * 设计要点：
 * - 所有错误都被捕获并转为 ToolResult（isError=true），不会抛异常
 *   这样 Agent 循环不会因为单个工具失败而崩溃，LLM 可以看到错误信息并调整策略
 * - 错误信息包含可用工具列表（工具不存在时），帮助 LLM 自行纠正
 *
 * 架构位置：Scheduler 层，被 Scheduler 调用来执行具体的工具。
 */

import { TimeoutError, ToolExecutionError, ToolValidationError } from '../errors/errors.js';
import type { ToolContext, ToolResult } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';

/** 默认工具执行超时（30 秒），可通过工具级或全局参数覆盖 */
const DEFAULT_TOOL_TIMEOUT = 30_000;

/** 来自 LLM 的工具调用请求 */
export interface ToolCallRequest {
  /** LLM 分配的调用 ID，用于关联请求和结果 */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** 工具执行结果（包含调用 ID，方便 Agent 循环匹配） */
export interface ToolCallResult {
  id: string;
  name: string;
  result: ToolResult;
}

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  /**
   * 执行单个工具调用：查找工具 → Zod 校验参数 → 执行（含超时）→ 返回结果。
   * 任何阶段的失败都会被优雅处理为错误结果（不抛异常）。
   *
   * @param globalTimeout 全局超时（毫秒），被工具级 timeout 覆盖；0 或 Infinity 表示不限时
   */
  async execute(
    request: ToolCallRequest,
    context: ToolContext,
    globalTimeout?: number,
  ): Promise<ToolCallResult> {
    const tool = this.registry.get(request.name);

    // 工具不存在时，返回可用工具列表帮助 LLM 自行纠正
    if (!tool) {
      return {
        id: request.id,
        name: request.name,
        result: {
          content: `Error: Tool "${request.name}" not found. Available tools: ${this.registry.getNames().join(', ')}`,
          isError: true,
        },
      };
    }

    // 用 Zod safeParse 校验参数，避免将无效参数传给工具实现
    // LLM 生成的参数不一定符合 Schema，这是常见情况
    const parseResult = tool.parameters.safeParse(request.args);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(
        (e) => `${e.path.join('.')}: ${e.message}`,
      );
      return {
        id: request.id,
        name: request.name,
        result: {
          content: `Validation error for tool "${request.name}": ${errors.join('; ')}`,
          isError: true,
        },
      };
    }

    // 确定有效超时：工具级 > 全局 > 默认 30s
    const effectiveTimeout = tool.timeout ?? globalTimeout ?? DEFAULT_TOOL_TIMEOUT;

    // 执行工具，捕获所有异常转为错误结果
    try {
      const executionPromise = tool.execute(parseResult.data, context);
      const rawResult = await this.executeWithTimeout(
        executionPromise,
        effectiveTimeout,
        request.name,
      );
      const result: ToolResult =
        typeof rawResult === 'string' ? { content: rawResult } : rawResult;

      return {
        id: request.id,
        name: request.name,
        result,
      };
    } catch (error) {
      // 超时错误单独处理，提供更明确的错误信息
      if (error instanceof TimeoutError) {
        return {
          id: request.id,
          name: request.name,
          result: {
            content: `Tool "${request.name}" timed out after ${error.timeoutMs}ms`,
            isError: true,
          },
        };
      }

      const message =
        error instanceof Error ? error.message : String(error);
      return {
        id: request.id,
        name: request.name,
        result: {
          content: `Tool "${request.name}" execution error: ${message}`,
          isError: true,
        },
      };
    }
  }

  /**
   * 用 Promise.race 为工具执行加超时保护。
   * timeout <= 0 或 Infinity 时直接返回原 Promise（不限时）。
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    toolName: string,
  ): Promise<T> {
    // 0 或 Infinity 表示不限时，直接透传
    if (timeoutMs <= 0 || !isFinite(timeoutMs)) {
      return promise;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new TimeoutError(
            `Tool "${toolName}" timed out after ${timeoutMs}ms`,
            timeoutMs,
            'tool',
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      // 无论正常完成还是超时，都清理定时器，避免内存泄漏
      clearTimeout(timer);
    }
  }
}
