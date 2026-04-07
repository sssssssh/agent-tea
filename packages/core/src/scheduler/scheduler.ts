/**
 * Scheduler —— 工具调度器
 *
 * 负责协调一轮 LLM 响应中多个工具调用的执行。
 *
 * 调度策略：默认并行执行，带 `sequential` 标签的工具顺序执行。
 * 分组规则：遍历工具调用列表，连续的非 sequential 工具归为一个并行组，
 * sequential 工具单独成组。组间顺序执行，并行组内 Promise.all 并发。
 *
 * 这样既保证了有依赖关系的工具（如文件写入）的执行顺序，
 * 又让无依赖的工具（如多个只读查询）可以并行加速。
 *
 * 架构位置：Core 层的 Scheduler 子模块，位于 Agent 和 ToolExecutor 之间。
 * Agent 不直接调用 ToolExecutor，而是通过 Scheduler 间接调用，
 * 这样调度策略的变更不影响 Agent 循环。
 */

import type { ToolContext } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ToolExecutor, type ToolCallRequest, type ToolCallResult } from './executor.js';

/** 一组可以一起执行的工具调用 */
interface ExecutionGroup {
  requests: ToolCallRequest[];
  parallel: boolean;
}

export class Scheduler {
  private executor: ToolExecutor;
  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.executor = new ToolExecutor(registry);
    this.registry = registry;
  }

  /**
   * 批量执行工具调用，逐个 yield 结果。
   * 使用 AsyncGenerator 使 Agent 可以在每个工具完成后立即发出事件，
   * 而不需要等所有工具都执行完毕。
   *
   * 按分组策略执行：并行组内 Promise.all 并发，组间顺序执行。
   */
  async *execute(
    requests: ToolCallRequest[],
    context: ToolContext,
    globalTimeout?: number,
  ): AsyncGenerator<ToolCallResult> {
    const groups = this.groupRequests(requests);

    for (const group of groups) {
      // 组级取消检查：已取消则整组返回取消结果，用 continue 保证每个请求都有响应
      if (context.signal.aborted) {
        for (const req of group.requests) {
          yield this.createAbortedResult(req);
        }
        continue;
      }

      if (group.parallel && group.requests.length > 1) {
        // 并行执行：无 sequential 标签的连续工具可安全并发
        const results = await Promise.all(
          group.requests.map((req) => this.executor.execute(req, context, globalTimeout)),
        );
        for (const result of results) yield result;
      } else {
        // 顺序执行：单个工具或 sequential 组
        for (const req of group.requests) {
          if (context.signal.aborted) {
            yield this.createAbortedResult(req);
            continue;
          }
          yield await this.executor.execute(req, context, globalTimeout);
        }
      }
    }
  }

  /**
   * 执行单个工具调用。
   * 当审批系统逐个处理工具调用时使用，避免批量执行的 AsyncGenerator 复杂性。
   */
  async executeSingle(
    request: ToolCallRequest,
    context: ToolContext,
    globalTimeout?: number,
  ): Promise<ToolCallResult> {
    if (context.signal.aborted) {
      return this.createAbortedResult(request);
    }

    return this.executor.execute(request, context, globalTimeout);
  }

  /**
   * 将工具调用按 sequential 标签分组。
   * 连续的非 sequential 工具归为一个并行组，sequential 工具单独一组。
   */
  private groupRequests(requests: ToolCallRequest[]): ExecutionGroup[] {
    const groups: ExecutionGroup[] = [];
    let parallelBuffer: ToolCallRequest[] = [];

    const flushParallelBuffer = () => {
      if (parallelBuffer.length > 0) {
        groups.push({ requests: parallelBuffer, parallel: true });
        parallelBuffer = [];
      }
    };

    for (const req of requests) {
      const tool = this.registry.get(req.name);
      const isSequential = tool?.tags?.includes('sequential') ?? false;

      if (isSequential) {
        flushParallelBuffer();
        groups.push({ requests: [req], parallel: false });
      } else {
        parallelBuffer.push(req);
      }
    }

    // 遍历结束后 flush 剩余缓冲区
    flushParallelBuffer();

    return groups;
  }

  /** 创建取消结果，避免重复代码 */
  private createAbortedResult(request: ToolCallRequest): ToolCallResult {
    return {
      id: request.id,
      name: request.name,
      result: { content: 'Tool execution cancelled', isError: true },
    };
  }
}
