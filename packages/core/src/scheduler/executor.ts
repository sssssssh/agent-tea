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

import { ToolExecutionError, ToolValidationError } from '../errors/errors.js';
import type { ToolContext, ToolResult } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';

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
   * 执行单个工具调用：查找工具 → Zod 校验参数 → 执行 → 返回结果。
   * 任何阶段的失败都会被优雅处理为错误结果（不抛异常）。
   */
  async execute(
    request: ToolCallRequest,
    context: ToolContext,
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

    // 执行工具，捕获所有异常转为错误结果
    try {
      const rawResult = await tool.execute(parseResult.data, context);
      const result: ToolResult =
        typeof rawResult === 'string' ? { content: rawResult } : rawResult;

      return {
        id: request.id,
        name: request.name,
        result,
      };
    } catch (error) {
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
}
