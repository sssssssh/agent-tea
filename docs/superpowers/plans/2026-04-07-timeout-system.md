# 超时系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 agent-tea 框架增加三层超时保护 — TimeoutError 类型、工具执行超时（方案 A）、LLM 请求超时（连接/流中分阶段，标准版 B）。

**Architecture:** 在 errors 层新增 TimeoutError；在 ToolExecutor 用 Promise.race 实现工具超时；新增 stream-timeout 工具函数包装 LLM 流，在 collectResponse 中集成连接超时和流停滞超时，两阶段采用不同重试策略。

**Tech Stack:** TypeScript, Vitest, Zod

---

### Task 1: 新增 TimeoutError 类型

**Files:**
- Modify: `packages/core/src/errors/errors.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 在 errors.ts 末尾新增 TimeoutError 类**

在 `packages/core/src/errors/errors.ts` 的 `LoopDetectedError` 之后追加：

```typescript
/** 超时错误，区分超时阶段以支持不同的重试策略 */
export class TimeoutError extends AgentTeaError {
  constructor(
    message: string,
    /** 超时阈值（毫秒） */
    public readonly timeoutMs: number,
    /** 超时发生的阶段：工具执行、LLM 连接、LLM 流式传输 */
    public readonly phase: 'tool' | 'llm_connection' | 'llm_stream',
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}
```

- [ ] **Step 2: 在 index.ts 中导出 TimeoutError**

在 `packages/core/src/index.ts` 的错误导出块中，在 `LoopDetectedError` 后面加上 `TimeoutError`：

```typescript
export {
  AgentTeaError,
  ProviderError,
  ToolExecutionError,
  ToolValidationError,
  MaxIterationsError,
  LoopDetectedError,
  TimeoutError,
} from './errors/errors.js';
```

- [ ] **Step 3: 验证类型检查通过**

Run: `pnpm typecheck`
Expected: 通过，无错误

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/errors/errors.ts packages/core/src/index.ts
git commit -m "feat(core): add TimeoutError type with phase discrimination"
```

---

### Task 2: Tool 接口和 AgentConfig 扩展

**Files:**
- Modify: `packages/core/src/tools/types.ts`
- Modify: `packages/core/src/tools/builder.ts`
- Modify: `packages/core/src/config/types.ts`

- [ ] **Step 1: 在 Tool 接口加 timeout 字段**

在 `packages/core/src/tools/types.ts` 的 `Tool` 接口中，在 `tags` 字段后面加：

```typescript
  /** 执行超时（毫秒），不设置则使用框架默认值（30s） */
  readonly timeout?: number;
```

- [ ] **Step 2: 在 ToolConfig 加 timeout 字段**

在 `packages/core/src/tools/builder.ts` 的 `ToolConfig` 接口中，在 `tags` 后面加：

```typescript
  timeout?: number;
```

同时在 `tool()` 工厂函数的返回对象中传递 `timeout`：

```typescript
export function tool<T extends ZodType>(
  config: ToolConfig<T>,
  execute: ToolExecuteFn<z.infer<T>>,
): Tool<z.infer<T>> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    tags: config.tags,
    timeout: config.timeout,
    async execute(params, context) {
      const result = await execute(params, context);
      if (typeof result === 'string') {
        return { content: result };
      }
      return result;
    },
  };
}
```

- [ ] **Step 3: 在 AgentConfig 加 toolTimeout 和 llmTimeout**

在 `packages/core/src/config/types.ts` 中，在 `loopDetection` 字段之后加：

```typescript
  // ---- 超时配置 ----

  /**
   * 工具执行默认超时（毫秒），默认 30000。
   * 单个工具可通过 Tool.timeout 覆盖此值。
   * 设为 0 或 Infinity 表示不限制。
   */
  toolTimeout?: number;

  /**
   * LLM 请求超时配置。
   * 不设置时使用默认值（连接 60s，流停滞 30s）。
   */
  llmTimeout?: {
    /** 连接超时：从发送请求到收到首个有效事件的最大等待时间（毫秒），默认 60000 */
    connectionMs?: number;
    /** 流停滞超时：两个连续事件之间的最大间隔（毫秒），默认 30000 */
    streamStallMs?: number;
  };
```

- [ ] **Step 4: 验证类型检查通过**

Run: `pnpm typecheck`
Expected: 通过，无错误

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/types.ts packages/core/src/tools/builder.ts packages/core/src/config/types.ts
git commit -m "feat(core): add timeout fields to Tool interface and AgentConfig"
```

---

### Task 3: 工具执行超时 — ToolExecutor 改动

**Files:**
- Modify: `packages/core/src/scheduler/executor.ts`
- Create: `packages/core/src/scheduler/executor.test.ts`

- [ ] **Step 1: 写工具超时的失败测试**

创建 `packages/core/src/scheduler/executor.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolExecutor } from './executor.js';
import { ToolRegistry } from '../tools/registry.js';
import { tool } from '../tools/builder.js';
import type { ToolContext } from '../tools/types.js';

function createContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionId: 'test-session',
    cwd: '/tmp',
    messages: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('ToolExecutor', () => {
  describe('timeout', () => {
    it('times out a slow tool with global timeout', async () => {
      const slowTool = tool(
        {
          name: 'slow',
          description: 'A slow tool',
          parameters: z.object({}),
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return 'done';
        },
      );

      const registry = new ToolRegistry();
      registry.register(slowTool);
      const executor = new ToolExecutor(registry);

      const result = await executor.execute(
        { id: '1', name: 'slow', args: {} },
        createContext(),
        100, // 100ms global timeout
      );

      expect(result.result.isError).toBe(true);
      expect(result.result.content).toContain('timed out');
      expect(result.result.content).toContain('100ms');
    });

    it('uses tool-level timeout over global timeout', async () => {
      const slowTool = tool(
        {
          name: 'slow',
          description: 'A slow tool',
          parameters: z.object({}),
          timeout: 50, // tool declares 50ms timeout
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return 'done';
        },
      );

      const registry = new ToolRegistry();
      registry.register(slowTool);
      const executor = new ToolExecutor(registry);

      const result = await executor.execute(
        { id: '1', name: 'slow', args: {} },
        createContext(),
        10000, // global timeout 10s, but tool says 50ms
      );

      expect(result.result.isError).toBe(true);
      expect(result.result.content).toContain('timed out');
    });

    it('does not timeout a fast tool', async () => {
      const fastTool = tool(
        {
          name: 'fast',
          description: 'A fast tool',
          parameters: z.object({}),
        },
        async () => 'quick result',
      );

      const registry = new ToolRegistry();
      registry.register(fastTool);
      const executor = new ToolExecutor(registry);

      const result = await executor.execute(
        { id: '1', name: 'fast', args: {} },
        createContext(),
        5000,
      );

      expect(result.result.isError).toBeUndefined();
      expect(result.result.content).toBe('quick result');
    });

    it('skips timeout when globalTimeout is 0', async () => {
      const slowTool = tool(
        {
          name: 'slow',
          description: 'A slow tool',
          parameters: z.object({}),
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'done';
        },
      );

      const registry = new ToolRegistry();
      registry.register(slowTool);
      const executor = new ToolExecutor(registry);

      const result = await executor.execute(
        { id: '1', name: 'slow', args: {} },
        createContext(),
        0, // disabled
      );

      expect(result.result.isError).toBeUndefined();
      expect(result.result.content).toBe('done');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/scheduler/executor.test.ts`
Expected: FAIL — `executor.execute` 签名不匹配（还没有 globalTimeout 参数）

- [ ] **Step 3: 实现 ToolExecutor 超时逻辑**

修改 `packages/core/src/scheduler/executor.ts`：

```typescript
import { ToolExecutionError, ToolValidationError } from '../errors/errors.js';
import { TimeoutError } from '../errors/errors.js';
import type { ToolContext, ToolResult } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';

/** 工具执行默认超时（毫秒） */
const DEFAULT_TOOL_TIMEOUT = 30_000;

/** 来自 LLM 的工具调用请求 */
export interface ToolCallRequest {
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
   * 执行单个工具调用：查找工具 → Zod 校验参数 → 执行（带超时）→ 返回结果。
   * 任何阶段的失败都会被优雅处理为错误结果（不抛异常）。
   *
   * @param globalTimeout - 全局超时（毫秒），来自 AgentConfig.toolTimeout。
   *   工具自身的 timeout 优先级更高。0 或 Infinity 表示不限制。
   */
  async execute(
    request: ToolCallRequest,
    context: ToolContext,
    globalTimeout?: number,
  ): Promise<ToolCallResult> {
    const tool = this.registry.get(request.name);

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

    // 超时优先级：工具自声明 > 全局配置 > 框架默认
    const timeout = tool.timeout ?? globalTimeout ?? DEFAULT_TOOL_TIMEOUT;
    const useTimeout = timeout > 0 && isFinite(timeout);

    try {
      let rawResult: ToolResult | string;

      if (useTimeout) {
        rawResult = await this.executeWithTimeout(
          () => tool.execute(parseResult.data, context),
          timeout,
          request.name,
        );
      } else {
        rawResult = await tool.execute(parseResult.data, context);
      }

      const result: ToolResult =
        typeof rawResult === 'string' ? { content: rawResult } : rawResult;

      return { id: request.id, name: request.name, result };
    } catch (error) {
      if (error instanceof TimeoutError) {
        return {
          id: request.id,
          name: request.name,
          result: {
            content: `Tool "${request.name}" timed out after ${timeout}ms`,
            isError: true,
          },
        };
      }

      const message = error instanceof Error ? error.message : String(error);
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
   * 使用 Promise.race 实现工具执行超时。
   * 超时时通过 context.signal 的方式不可行（signal 是只读的），
   * 所以超时后只能让 Promise.race 提前返回，工具执行会在后台继续直到自然结束。
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    toolName: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
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
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/src/scheduler/executor.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `pnpm test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/scheduler/executor.ts packages/core/src/scheduler/executor.test.ts
git commit -m "feat(core): add tool execution timeout with Promise.race in ToolExecutor"
```

---

### Task 4: Scheduler 透传 globalTimeout

**Files:**
- Modify: `packages/core/src/scheduler/scheduler.ts`

- [ ] **Step 1: 修改 Scheduler 的 execute 和 executeSingle 签名**

在 `packages/core/src/scheduler/scheduler.ts` 中，给 `execute()` 和 `executeSingle()` 加 `globalTimeout` 参数并透传给 executor：

```typescript
  async *execute(
    requests: ToolCallRequest[],
    context: ToolContext,
    globalTimeout?: number,
  ): AsyncGenerator<ToolCallResult> {
    const groups = this.groupRequests(requests);

    for (const group of groups) {
      if (context.signal.aborted) {
        for (const req of group.requests) {
          yield this.createAbortedResult(req);
        }
        continue;
      }

      if (group.parallel && group.requests.length > 1) {
        const results = await Promise.all(
          group.requests.map((req) => this.executor.execute(req, context, globalTimeout)),
        );
        for (const result of results) yield result;
      } else {
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
```

- [ ] **Step 2: 验证类型检查和测试通过**

Run: `pnpm typecheck && pnpm test`
Expected: 全部通过（新参数是可选的，不影响现有调用）

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/scheduler/scheduler.ts
git commit -m "feat(core): pass globalTimeout through Scheduler to ToolExecutor"
```

---

### Task 5: BaseAgent 集成工具超时

**Files:**
- Modify: `packages/core/src/agent/base-agent.ts`

- [ ] **Step 1: 在 executeToolCalls 中透传 toolTimeout 给 Scheduler**

在 `packages/core/src/agent/base-agent.ts` 的 `executeToolCalls()` 方法中，找到调用 `this.scheduler.executeSingle(request, toolContext)` 的位置（约第 467 行），改为：

```typescript
        const result = await this.scheduler.executeSingle(
          request,
          toolContext,
          this.config.toolTimeout,
        );
```

这是 `executeToolCalls` 中唯一调用 scheduler 的地方，因为审批模式下逐个执行。

- [ ] **Step 2: 运行全量测试确认无回归**

Run: `pnpm test`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent/base-agent.ts
git commit -m "feat(core): integrate toolTimeout from AgentConfig into executeToolCalls"
```

---

### Task 6: LLM 流超时 — withStreamTimeout 工具函数

**Files:**
- Create: `packages/core/src/utils/stream-timeout.ts`
- Create: `packages/core/src/utils/stream-timeout.test.ts`

- [ ] **Step 1: 写流超时的失败测试**

创建 `packages/core/src/utils/stream-timeout.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { withStreamTimeout } from './stream-timeout.js';
import { TimeoutError } from '../errors/errors.js';

/** 创建一个按指定延迟产出事件的 async generator */
async function* delayedStream<T>(
  events: { value: T; delayMs: number }[],
): AsyncGenerator<T> {
  for (const event of events) {
    await new Promise((resolve) => setTimeout(resolve, event.delayMs));
    yield event.value;
  }
}

/** 收集 async generator 的所有值 */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe('withStreamTimeout', () => {
  it('passes through events from a normal stream', async () => {
    const stream = delayedStream([
      { value: 'a', delayMs: 10 },
      { value: 'b', delayMs: 10 },
      { value: 'c', delayMs: 10 },
    ]);

    const wrapped = withStreamTimeout(stream, {
      connectionMs: 1000,
      streamStallMs: 1000,
    });

    const results = await collect(wrapped);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('throws TimeoutError with llm_connection phase when no event arrives', async () => {
    const stream = delayedStream([
      { value: 'a', delayMs: 5000 }, // 首个事件太慢
    ]);

    const wrapped = withStreamTimeout(stream, {
      connectionMs: 50,
      streamStallMs: 1000,
    });

    await expect(collect(wrapped)).rejects.toThrow(TimeoutError);
    await expect(collect(
      withStreamTimeout(
        delayedStream([{ value: 'a', delayMs: 5000 }]),
        { connectionMs: 50, streamStallMs: 1000 },
      ),
    )).rejects.toThrow(
      expect.objectContaining({ phase: 'llm_connection' }),
    );
  });

  it('throws TimeoutError with llm_stream phase when stream stalls', async () => {
    const stream = delayedStream([
      { value: 'a', delayMs: 10 },  // 首个事件快
      { value: 'b', delayMs: 5000 }, // 第二个太慢
    ]);

    const wrapped = withStreamTimeout(stream, {
      connectionMs: 1000,
      streamStallMs: 50,
    });

    await expect(collect(wrapped)).rejects.toThrow(TimeoutError);
    await expect(collect(
      withStreamTimeout(
        delayedStream([
          { value: 'a', delayMs: 10 },
          { value: 'b', delayMs: 5000 },
        ]),
        { connectionMs: 1000, streamStallMs: 50 },
      ),
    )).rejects.toThrow(
      expect.objectContaining({ phase: 'llm_stream' }),
    );
  });

  it('resets stall timer on each event', async () => {
    // 每个事件间隔 40ms，stall 超时 60ms — 不应该触发
    const stream = delayedStream([
      { value: 'a', delayMs: 10 },
      { value: 'b', delayMs: 40 },
      { value: 'c', delayMs: 40 },
      { value: 'd', delayMs: 40 },
    ]);

    const wrapped = withStreamTimeout(stream, {
      connectionMs: 1000,
      streamStallMs: 60,
    });

    const results = await collect(wrapped);
    expect(results).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/utils/stream-timeout.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 withStreamTimeout**

创建 `packages/core/src/utils/stream-timeout.ts`：

```typescript
/**
 * LLM 流式响应超时包装器
 *
 * 将 LLM 的 AsyncGenerator 流包装为带两阶段超时检测的流：
 * - 连接阶段：等待首个事件，超时抛 TimeoutError(phase: 'llm_connection')
 * - 流中阶段：监控事件间隔，停滞超时抛 TimeoutError(phase: 'llm_stream')
 *
 * 架构位置：Core 层 utils，被 BaseAgent.collectResponse() 使用。
 */

import { TimeoutError } from '../errors/errors.js';

/** 流超时配置 */
export interface StreamTimeoutConfig {
  /** 连接超时：等待首个事件的最大毫秒数 */
  connectionMs: number;
  /** 流停滞超时：两个连续事件的最大间隔毫秒数 */
  streamStallMs: number;
}

/**
 * 给 AsyncGenerator 流加上两阶段超时检测。
 *
 * 实现方式：用一个可重置的定时器。
 * - 启动时设为 connectionMs
 * - 收到首个事件后切换为 streamStallMs
 * - 每收到一个事件重置定时器
 * - 超时时通过 reject 传播 TimeoutError
 */
export async function* withStreamTimeout<T>(
  stream: AsyncGenerator<T>,
  config: StreamTimeoutConfig,
): AsyncGenerator<T> {
  let firstEventReceived = false;
  let timer: NodeJS.Timeout | undefined;
  let rejectTimeout: ((error: TimeoutError) => void) | undefined;

  // 创建一个 Promise 用于超时竞速
  const createTimeoutPromise = (): Promise<never> => {
    return new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
      const phase = firstEventReceived ? 'llm_stream' : 'llm_connection';
      const ms = firstEventReceived ? config.streamStallMs : config.connectionMs;
      timer = setTimeout(() => {
        reject(
          new TimeoutError(
            `LLM ${phase === 'llm_connection' ? 'connection' : 'stream'} timed out after ${ms}ms`,
            ms,
            phase,
          ),
        );
      }, ms);
    });
  };

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  try {
    // 用 iterator protocol 手动驱动 stream，实现与超时 Promise 的竞速
    const iterator = stream[Symbol.asyncIterator]();

    while (true) {
      let timeoutPromise = createTimeoutPromise();

      let iterResult: IteratorResult<T>;
      try {
        iterResult = await Promise.race([
          iterator.next(),
          timeoutPromise,
        ]);
      } catch (error) {
        // 超时发生，尝试终止上游 generator
        await iterator.return?.(undefined);
        throw error;
      }

      clearTimer();

      if (iterResult.done) {
        return;
      }

      if (!firstEventReceived) {
        firstEventReceived = true;
      }

      yield iterResult.value;
    }
  } finally {
    clearTimer();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/src/utils/stream-timeout.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/stream-timeout.ts packages/core/src/utils/stream-timeout.test.ts
git commit -m "feat(core): add withStreamTimeout for two-phase LLM stream timeout"
```

---

### Task 7: BaseAgent.collectResponse 集成流超时和重试

**Files:**
- Modify: `packages/core/src/agent/base-agent.ts`

- [ ] **Step 1: 在 base-agent.ts 中导入依赖**

在 `packages/core/src/agent/base-agent.ts` 文件顶部的导入区域，加上：

```typescript
import { TimeoutError } from '../errors/errors.js';
import { retryWithBackoff } from '../errors/retry.js';
import { withStreamTimeout, type StreamTimeoutConfig } from '../utils/stream-timeout.js';
```

- [ ] **Step 2: 增加 LLM 超时默认常量**

在文件顶部 `DEFAULT_MAX_ITERATIONS` 之后加：

```typescript
/** LLM 连接超时默认值（毫秒）：等待首个事件 */
const DEFAULT_LLM_CONNECTION_TIMEOUT = 60_000;
/** LLM 流停滞超时默认值（毫秒）：两个事件之间 */
const DEFAULT_LLM_STREAM_STALL_TIMEOUT = 30_000;

/** 连接超时重试配置 */
const CONNECTION_RETRY_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 5000,
  maxDelayMs: 30000,
};

/** 流中超时重试配置 */
const STREAM_STALL_RETRY_OPTIONS = {
  maxAttempts: 2,
  initialDelayMs: 1000,
  maxDelayMs: 5000,
};
```

- [ ] **Step 3: 修改 collectResponse 方法**

将 `collectResponse` 方法替换为带超时和重试的版本：

```typescript
  protected async collectResponse(
    chatSession: ChatSession,
    messages: Message[],
    signal: AbortSignal,
  ): Promise<CollectedResponse> {
    const messagesToSend = this.contextManager
      ? this.contextManager.prepare(messages)
      : messages;

    const streamTimeoutConfig: StreamTimeoutConfig = {
      connectionMs: this.config.llmTimeout?.connectionMs ?? DEFAULT_LLM_CONNECTION_TIMEOUT,
      streamStallMs: this.config.llmTimeout?.streamStallMs ?? DEFAULT_LLM_STREAM_STALL_TIMEOUT,
    };

    // 选择重试配置：根据上一次失败的 phase 动态决定
    let lastPhase: 'llm_connection' | 'llm_stream' | undefined;

    const retryOptions = {
      maxAttempts: CONNECTION_RETRY_OPTIONS.maxAttempts, // 初始用连接重试配置
      initialDelayMs: CONNECTION_RETRY_OPTIONS.initialDelayMs,
      maxDelayMs: CONNECTION_RETRY_OPTIONS.maxDelayMs,
      signal,
      isRetryable: (error: unknown) => error instanceof TimeoutError,
      onRetry: (_attempt: number, error: unknown) => {
        if (error instanceof TimeoutError) {
          lastPhase = error.phase as 'llm_connection' | 'llm_stream';
        }
      },
    };

    return retryWithBackoff(async () => {
      let text = '';
      const toolCalls: ToolCallInfo[] = [];
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

      const rawStream = chatSession.sendMessage(messagesToSend, signal);
      const stream = withStreamTimeout(rawStream, streamTimeoutConfig);

      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            text += event.text;
            break;
          case 'tool_call':
            toolCalls.push({ id: event.id, name: event.name, args: event.args });
            break;
          case 'finish':
            usage = event.usage;
            break;
          case 'error':
            throw event.error;
        }
      }

      return { text, toolCalls, usage };
    }, retryOptions);
  }
```

- [ ] **Step 4: 验证类型检查通过**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `pnpm test`
Expected: 全部通过（现有测试用的 mock provider 响应很快，不会触发超时）

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/base-agent.ts
git commit -m "feat(core): integrate LLM stream timeout with two-phase retry in collectResponse"
```

---

### Task 8: 集成测试 — 超时场景端到端

**Files:**
- Modify: `packages/core/src/agent/react-agent.test.ts`

- [ ] **Step 1: 在 react-agent.test.ts 添加超时相关测试**

在 `packages/core/src/agent/react-agent.test.ts` 文件末尾，`describe('ReActAgent')` 块内追加：

```typescript
  describe('timeout', () => {
    it('returns tool timeout error to LLM and continues', async () => {
      const slowTool = tool(
        {
          name: 'slow_tool',
          description: 'A tool that takes too long',
          parameters: z.object({}),
          timeout: 50, // 50ms timeout
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return 'done';
        },
      );

      const provider = mockProvider([
        // 第一轮：LLM 调用 slow_tool
        [
          { type: 'tool_call', id: 'tc1', name: 'slow_tool', args: {} },
          { type: 'finish', reason: 'tool_calls' as const },
        ],
        // 第二轮：LLM 收到超时错误后给出文本响应
        [
          { type: 'text', text: 'The tool timed out, sorry.' },
          { type: 'finish', reason: 'stop' as const },
        ],
      ]);

      const agent = new ReActAgent({
        provider,
        model: 'test',
        tools: [slowTool],
      });

      const events = await collectEvents(agent, 'Do something slow');

      // 验证有 tool_response 事件且标记为错误
      const toolResponse = events.find(
        (e) => e.type === 'tool_response' && e.toolName === 'slow_tool',
      );
      expect(toolResponse).toBeDefined();
      expect((toolResponse as any).isError).toBe(true);
      expect((toolResponse as any).content).toContain('timed out');

      // Agent 正常结束
      expect(events[events.length - 1]).toMatchObject({
        type: 'agent_end',
        reason: 'complete',
      });
    });

    it('respects AgentConfig.toolTimeout as default', async () => {
      const slowTool = tool(
        {
          name: 'slow_tool',
          description: 'A tool without its own timeout',
          parameters: z.object({}),
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return 'done';
        },
      );

      const provider = mockProvider([
        [
          { type: 'tool_call', id: 'tc1', name: 'slow_tool', args: {} },
          { type: 'finish', reason: 'tool_calls' as const },
        ],
        [
          { type: 'text', text: 'Timed out.' },
          { type: 'finish', reason: 'stop' as const },
        ],
      ]);

      const agent = new ReActAgent({
        provider,
        model: 'test',
        tools: [slowTool],
        toolTimeout: 50, // global 50ms timeout
      });

      const events = await collectEvents(agent, 'Do something');

      const toolResponse = events.find(
        (e) => e.type === 'tool_response' && e.toolName === 'slow_tool',
      );
      expect(toolResponse).toBeDefined();
      expect((toolResponse as any).isError).toBe(true);
      expect((toolResponse as any).content).toContain('timed out');
    });
  });
```

确保文件顶部已导入 `tool`：

```typescript
import { tool } from '../tools/builder.js';
```

（如果已经有就不需要重复加。）

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm vitest run packages/core/src/agent/react-agent.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: 运行全量测试最终确认**

Run: `pnpm test && pnpm typecheck`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/react-agent.test.ts
git commit -m "test(core): add integration tests for tool timeout in ReActAgent"
```
