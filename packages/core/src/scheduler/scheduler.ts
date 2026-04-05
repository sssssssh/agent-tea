/**
 * Scheduler —— 工具调度器
 *
 * 负责协调一轮 LLM 响应中多个工具调用的执行。
 *
 * 当前实现采用顺序执行策略，原因：
 * - 简单可靠，便于调试
 * - 多数场景下工具调用之间存在隐含依赖（如先读文件再修改）
 *
 * 未来可扩展为并行执行（对于确认无依赖的工具调用），
 * 只需替换这里的调度逻辑，Agent 层无需修改。
 *
 * 架构位置：Core 层的 Scheduler 子模块，位于 Agent 和 ToolExecutor 之间。
 * Agent 不直接调用 ToolExecutor，而是通过 Scheduler 间接调用，
 * 这样调度策略的变更不影响 Agent 循环。
 */

import type { ToolContext } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ToolExecutor, type ToolCallRequest, type ToolCallResult } from './executor.js';

export class Scheduler {
  private executor: ToolExecutor;

  constructor(registry: ToolRegistry) {
    this.executor = new ToolExecutor(registry);
  }

  /**
   * 批量执行工具调用，逐个 yield 结果。
   * 使用 AsyncGenerator 使 Agent 可以在每个工具完成后立即发出事件，
   * 而不需要等所有工具都执行完毕。
   */
  async *execute(
    requests: ToolCallRequest[],
    context: ToolContext,
  ): AsyncGenerator<ToolCallResult> {
    for (const request of requests) {
      // 每个工具执行前检查取消信号，已取消则跳过执行但仍返回结果
      // 用 continue 而非 return，确保所有请求都有对应的结果（LLM 需要每个调用都有响应）
      if (context.signal.aborted) {
        yield {
          id: request.id,
          name: request.name,
          result: {
            content: 'Tool execution cancelled',
            isError: true,
          },
        };
        continue;
      }

      yield await this.executor.execute(request, context);
    }
  }
}
