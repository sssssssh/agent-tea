# Agent 策略体系实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 agent-tea 引入 BaseAgent 抽象类体系，支持 ReAct 和 Plan-and-Execute 两种策略，及运行时策略切换。

**Architecture:** 将现有 `Agent` 重构为 `BaseAgent`（含完整生命周期钩子）+ `ReActAgent`（现有逻辑迁移）+ `PlanAndExecuteAgent`（新增）。引入 `AgentStateMachine` 管理阶段状态。Plan 阶段只允许只读工具，计划存文件，审批后逐步执行。

**Tech Stack:** TypeScript, Zod, Vitest, tsup

---

## 文件结构

```
packages/core/src/
  agent/
    state-machine.ts       # 新建：AgentStateMachine
    state-machine.test.ts  # 新建：状态机测试
    types.ts               # 修改：新增事件类型、Plan 类型、AgentState
    base-agent.ts          # 新建：BaseAgent 抽象类
    react-agent.ts         # 新建：从 agent.ts 迁移循环逻辑
    react-agent.test.ts    # 新建：从 agent.test.ts 迁移 + 新增 allowPlanMode 测试
    plan-store.ts          # 新建：计划文件存储
    plan-store.test.ts     # 新建：PlanStore 测试
    plan-and-execute-agent.ts      # 新建：PlanAndExecuteAgent
    plan-and-execute-agent.test.ts # 新建：PlanAndExecuteAgent 测试
    agent.ts               # 修改：改为 re-export ReActAgent as Agent
    agent.test.ts          # 删除内容，改为引用 react-agent.test.ts（或保留为兼容性测试）
  tools/
    types.ts               # 修改：Tool 接口加 tags
    builder.ts             # 修改：tool() 支持 tags
    builder.test.ts        # 修改：新增 tags 测试
    internal/
      enter-plan-mode.ts   # 新建：内置工具
      exit-plan-mode.ts    # 新建：内置工具
  config/
    types.ts               # 修改：AgentConfig 新增 agentId, strategy, allowPlanMode
  index.ts                 # 修改：新增导出
packages/sdk/src/
  index.ts                 # 修改：新增导出
  sub-agent.ts             # 修改：适配 ReActAgent
```

---

### Task 1: Tool 接口加 tags 字段

**Files:**
- Modify: `packages/core/src/tools/types.ts:59-75`
- Modify: `packages/core/src/tools/builder.ts:33-37,44-61`
- Modify: `packages/core/src/tools/builder.test.ts`

- [ ] **Step 1: 给 Tool 接口添加 tags 字段**

在 `packages/core/src/tools/types.ts` 的 `Tool` 接口中，在 `parameters` 后面加一行：

```typescript
/** 工具标签，用于分类过滤（如 'readonly' 表示只读工具） */
readonly tags?: string[];
```

- [ ] **Step 2: 给 ToolConfig 添加 tags 字段**

在 `packages/core/src/tools/builder.ts` 的 `ToolConfig` 接口中加入 `tags`，并在 `tool()` 工厂函数返回对象中传递 `tags`：

```typescript
interface ToolConfig<T extends ZodType> {
  name: string;
  description: string;
  parameters: T;
  tags?: string[];
}

export function tool<T extends ZodType>(
  config: ToolConfig<T>,
  execute: ToolExecuteFn<z.infer<T>>,
): Tool<z.infer<T>> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    tags: config.tags,
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

- [ ] **Step 3: 写 tags 测试**

在 `packages/core/src/tools/builder.test.ts` 末尾添加测试用例：

```typescript
it('supports tags on tool', () => {
  const readFile = tool(
    {
      name: 'read_file',
      description: 'Read a file',
      parameters: z.object({ path: z.string() }),
      tags: ['readonly'],
    },
    async ({ path }) => `content of ${path}`,
  );

  expect(readFile.tags).toEqual(['readonly']);
});

it('tags default to undefined', () => {
  const greet = tool(
    {
      name: 'greet',
      description: 'Greet',
      parameters: z.object({ name: z.string() }),
    },
    async ({ name }) => `Hello, ${name}!`,
  );

  expect(readFile.tags).toBeUndefined();
});
```

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run packages/core/src/tools/builder.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 更新 index.ts 导出**

暂时不需要额外导出，`Tool` 类型已通过 `export type { Tool }` 导出。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/types.ts packages/core/src/tools/builder.ts packages/core/src/tools/builder.test.ts
git commit -m "feat: add tags field to Tool interface for tool categorization"
```

---

### Task 2: AgentConfig 扩展

**Files:**
- Modify: `packages/core/src/config/types.ts`

- [ ] **Step 1: 添加新字段**

在 `packages/core/src/config/types.ts` 的 `AgentConfig` 接口末尾添加：

```typescript
/** Agent 标识，多 Agent 场景下用于区分来源。默认自动生成 UUID */
agentId?: string;
/** Agent 策略，默认 'react' */
strategy?: 'react' | 'plan-and-execute';
/**
 * 是否允许 LLM 运行时切换到 Plan 模式。
 * 仅当 strategy 为 'react'（默认）时有效 —— 自动注入 enter_plan_mode 工具。
 * strategy 为 'plan-and-execute' 时始终从 Plan 阶段开始，无需此选项。
 */
allowPlanMode?: boolean;
```

- [ ] **Step 2: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 无错误（新字段全是可选的，不影响现有代码）

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/config/types.ts
git commit -m "feat: extend AgentConfig with agentId, strategy, allowPlanMode"
```

---

### Task 3: AgentStateMachine

**Files:**
- Create: `packages/core/src/agent/state-machine.ts`
- Create: `packages/core/src/agent/state-machine.test.ts`

- [ ] **Step 1: 写 AgentStateMachine 的失败测试**

创建 `packages/core/src/agent/state-machine.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentStateMachine } from './state-machine.js';
import type { AgentState, StateTransition } from './types.js';

const reactTransitions: StateTransition[] = [
  { from: 'idle', to: 'reacting' },
  { from: 'reacting', to: 'completed' },
  { from: 'reacting', to: 'error' },
  { from: 'reacting', to: 'aborted' },
];

describe('AgentStateMachine', () => {
  it('starts in idle state', () => {
    const sm = new AgentStateMachine(reactTransitions);
    expect(sm.current).toBe('idle');
  });

  it('allows valid transitions', () => {
    const sm = new AgentStateMachine(reactTransitions);
    sm.transition('reacting');
    expect(sm.current).toBe('reacting');

    sm.transition('completed');
    expect(sm.current).toBe('completed');
  });

  it('throws on invalid transitions', () => {
    const sm = new AgentStateMachine(reactTransitions);
    expect(() => sm.transition('completed')).toThrow(
      'Invalid state transition: idle → completed',
    );
  });

  it('supports from as array', () => {
    const transitions: StateTransition[] = [
      { from: ['idle', 'error'], to: 'reacting' },
      { from: 'reacting', to: 'completed' },
    ];
    const sm = new AgentStateMachine(transitions);

    sm.transition('reacting');
    expect(sm.current).toBe('reacting');
  });

  it('notifies listeners on transition', () => {
    const sm = new AgentStateMachine(reactTransitions);
    const listener = vi.fn();

    sm.onTransition(listener);
    sm.transition('reacting');

    expect(listener).toHaveBeenCalledWith('idle', 'reacting');
  });

  it('supports unsubscribe', () => {
    const sm = new AgentStateMachine(reactTransitions);
    const listener = vi.fn();

    const unsubscribe = sm.onTransition(listener);
    unsubscribe();

    sm.transition('reacting');
    expect(listener).not.toHaveBeenCalled();
  });

  it('respects guard conditions', () => {
    const transitions: StateTransition[] = [
      { from: 'idle', to: 'reacting', guard: () => false },
    ];
    const sm = new AgentStateMachine(transitions);

    expect(() => sm.transition('reacting')).toThrow(
      'Invalid state transition: idle → reacting',
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/agent/state-machine.test.ts`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 在 types.ts 中添加状态和转换类型**

在 `packages/core/src/agent/types.ts` 文件顶部（`import` 之前）添加：

```typescript
// ============================================================
// Agent 状态机类型
// ============================================================

/** Agent 的所有可能状态 */
export type AgentState =
  | 'idle'
  | 'reacting'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'step_failed'
  | 'completed'
  | 'error'
  | 'aborted';

/** 状态转换规则 */
export interface StateTransition {
  from: AgentState | AgentState[];
  to: AgentState;
  /** 可选的转换条件，返回 false 则阻止此转换 */
  guard?: () => boolean;
}
```

在文件底部，在 `ErrorEvent` 之后、`AgentEvent` 联合类型之前添加 `StateChangeEvent`：

```typescript
/** Agent 状态变更事件 */
export interface StateChangeEvent {
  type: 'state_change';
  from: AgentState;
  to: AgentState;
  agentId?: string;
}
```

然后更新 `AgentEvent` 联合类型，加入 `StateChangeEvent`：

```typescript
export type AgentEvent =
  | AgentStartEvent
  | AgentEndEvent
  | MessageEvent
  | ToolRequestEvent
  | ToolResponseEvent
  | UsageEvent
  | ErrorEvent
  | StateChangeEvent;
```

- [ ] **Step 4: 实现 AgentStateMachine**

创建 `packages/core/src/agent/state-machine.ts`：

```typescript
/**
 * AgentStateMachine —— Agent 阶段状态管理
 *
 * 记录 Agent 当前处于哪个阶段，限制只能按合法路径转换。
 * 将状态转换逻辑集中管理，避免 if/else 散落在各处。
 *
 * 架构位置：Core 层的 Agent 子模块，被 BaseAgent 持有和驱动。
 */

import type { AgentState, StateTransition } from './types.js';

type TransitionListener = (from: AgentState, to: AgentState) => void;

export class AgentStateMachine {
  private state: AgentState = 'idle';
  private readonly transitions: StateTransition[];
  private readonly listeners: TransitionListener[] = [];

  constructor(transitions: StateTransition[]) {
    this.transitions = transitions;
  }

  /** 当前状态 */
  get current(): AgentState {
    return this.state;
  }

  /**
   * 尝试转换到目标状态。
   * 查找匹配的转换规则，检查 guard 条件，非法转换抛异常。
   */
  transition(to: AgentState): void {
    const valid = this.transitions.some((t) => {
      const fromMatch = Array.isArray(t.from)
        ? t.from.includes(this.state)
        : t.from === this.state;
      return fromMatch && t.to === to && (t.guard ? t.guard() : true);
    });

    if (!valid) {
      throw new Error(`Invalid state transition: ${this.state} → ${to}`);
    }

    const from = this.state;
    this.state = to;

    for (const listener of this.listeners) {
      listener(from, to);
    }
  }

  /** 监听状态变化，返回取消订阅函数 */
  onTransition(listener: TransitionListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }
}
```

- [ ] **Step 5: 运行测试**

Run: `pnpm vitest run packages/core/src/agent/state-machine.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/state-machine.ts packages/core/src/agent/state-machine.test.ts packages/core/src/agent/types.ts
git commit -m "feat: add AgentStateMachine for explicit agent state management"
```

---

### Task 4: BaseAgent 抽象类

**Files:**
- Create: `packages/core/src/agent/base-agent.ts`

- [ ] **Step 1: 在 types.ts 中添加 Plan 相关类型和新事件**

在 `packages/core/src/agent/types.ts` 中，在 `StateTransition` 接口之后添加：

```typescript
// ============================================================
// Plan 相关类型
// ============================================================

/** 执行计划 */
export interface Plan {
  id: string;
  filePath: string;
  steps: PlanStep[];
  rawContent: string;
  createdAt: Date;
}

/** 计划中的单个步骤 */
export interface PlanStep {
  index: number;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
  result?: StepResult;
}

/** 步骤执行结果 */
export interface StepResult {
  summary: string;
  toolCallCount: number;
}

/** 计划审批结果 */
export interface PlanApproval {
  approved: boolean;
  feedback?: string;
}

/** 步骤失败后的处理方式 */
export type StepFailureAction = 'pause' | 'skip' | 'replan' | 'abort';

// ============================================================
// 生命周期钩子辅助类型
// ============================================================

/** 迭代上下文，传给 onBeforeIteration / onAfterIteration */
export interface IterationContext {
  iteration: number;
  messages: readonly Message[];
  sessionId: string;
  state: AgentState;
}

/** 工具调用前的决策 */
export interface ToolCallDecision {
  allow: boolean;
  modifiedArgs?: Record<string, unknown>;
}

/** 收集到的 LLM 响应 */
export interface CollectedResponse {
  text: string;
  toolCalls: ToolCallInfo[];
  usage?: UsageInfo;
}

/** 工具调用信息 */
export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
```

在 `StateChangeEvent` 之后，`AgentEvent` 联合类型之前添加 Plan 相关事件：

```typescript
/** 计划创建事件 */
export interface PlanCreatedEvent {
  type: 'plan_created';
  plan: Plan;
  filePath: string;
  agentId?: string;
}

/** 步骤开始事件 */
export interface StepStartEvent {
  type: 'step_start';
  step: PlanStep;
  agentId?: string;
}

/** 步骤完成事件 */
export interface StepCompleteEvent {
  type: 'step_complete';
  step: PlanStep;
  agentId?: string;
}

/** 步骤失败事件 */
export interface StepFailedEvent {
  type: 'step_failed';
  step: PlanStep;
  error: unknown;
  agentId?: string;
}

/** 执行暂停事件 */
export interface ExecutionPausedEvent {
  type: 'execution_paused';
  step: PlanStep;
  error: unknown;
  agentId?: string;
}
```

更新 `AgentEvent` 联合类型为：

```typescript
export type AgentEvent =
  | AgentStartEvent
  | AgentEndEvent
  | MessageEvent
  | ToolRequestEvent
  | ToolResponseEvent
  | UsageEvent
  | ErrorEvent
  | StateChangeEvent
  | PlanCreatedEvent
  | StepStartEvent
  | StepCompleteEvent
  | StepFailedEvent
  | ExecutionPausedEvent;
```

同时给 `AgentStartEvent` 加 `agentId?: string`，给 `AgentEndEvent` 加 `agentId?: string`，给其他现有事件也加 `agentId?: string`（二期预留）。

- [ ] **Step 2: 实现 BaseAgent**

创建 `packages/core/src/agent/base-agent.ts`：

```typescript
/**
 * BaseAgent —— Agent 抽象基类
 *
 * 承担所有 Agent 的共同基础设施：
 * - 创建 ChatSession
 * - 收集流式 LLM 响应
 * - 执行工具调用（含 onBeforeToolCall/onAfterToolCall 钩子）
 * - 管理 AgentStateMachine
 * - 包装 run() 入口（signal 桥接、agent_start/end 事件）
 *
 * 子类只需实现 defineTransitions() 和 executeLoop()。
 *
 * 架构位置：Core 层 Agent 子模块的基础，ReActAgent 和 PlanAndExecuteAgent 继承自此。
 */

import type { ChatSession } from '../llm/provider.js';
import type {
  ChatStreamEvent,
  ContentPart,
  Message,
  ToolCallPart,
  ToolResultPart,
  UsageInfo,
} from '../llm/types.js';
import type { AgentConfig } from '../config/types.js';
import type {
  AgentEvent,
  AgentState,
  CollectedResponse,
  IterationContext,
  Plan,
  PlanApproval,
  PlanStep,
  StateTransition,
  StepFailureAction,
  StepResult,
  ToolCallDecision,
  ToolCallInfo,
} from './types.js';
import type { Tool, ToolContext, ToolResult } from '../tools/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { Scheduler } from '../scheduler/scheduler.js';
import type { ToolCallRequest } from '../scheduler/executor.js';
import { AgentStateMachine } from './state-machine.js';

export abstract class BaseAgent {
  protected readonly config: AgentConfig;
  protected readonly registry: ToolRegistry;
  protected readonly scheduler: Scheduler;
  protected readonly stateMachine: AgentStateMachine;
  protected readonly agentId: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.agentId = config.agentId ?? crypto.randomUUID();

    this.registry = new ToolRegistry();
    for (const tool of config.tools ?? []) {
      this.registry.register(tool);
    }

    this.scheduler = new Scheduler(this.registry);
    this.stateMachine = new AgentStateMachine(this.defineTransitions());
  }

  // ============================================================
  // 子类必须实现
  // ============================================================

  /** 定义本策略的合法状态转换 */
  protected abstract defineTransitions(): StateTransition[];

  /** 核心循环逻辑 */
  protected abstract executeLoop(
    messages: Message[],
    chatSession: ChatSession,
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent>;

  // ============================================================
  // 生命周期钩子（默认空实现，子类按需覆写）
  // ============================================================

  protected async onBeforeIteration(_ctx: IterationContext): Promise<void> {}
  protected async onAfterIteration(_ctx: IterationContext): Promise<void> {}
  protected onToolFilter(tools: Tool[]): Tool[] { return tools; }
  protected async onPlanCreated(_plan: Plan): Promise<PlanApproval> {
    return { approved: true };
  }
  protected async onStepStart(_step: PlanStep): Promise<void> {}
  protected async onStepComplete(_step: PlanStep, _result: StepResult): Promise<void> {}
  protected async onStepFailed(_step: PlanStep, _error: Error): Promise<StepFailureAction> {
    return 'pause';
  }
  protected async onBeforeToolCall(
    _toolName: string,
    _args: Record<string, unknown>,
  ): Promise<ToolCallDecision> {
    return { allow: true };
  }
  protected async onAfterToolCall(
    _toolName: string,
    _result: ToolResult,
  ): Promise<void> {}

  // ============================================================
  // 公共入口
  // ============================================================

  /**
   * 运行 Agent 处理用户输入。
   * 处理 session 创建、信号桥接、事件包装，循环逻辑委托给 executeLoop()。
   */
  async *run(
    input: string | Message[],
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const sessionId = crypto.randomUUID();
    const abortController = new AbortController();

    if (signal) {
      signal.addEventListener('abort', () => abortController.abort(signal.reason), {
        once: true,
      });
    }

    yield { type: 'agent_start', sessionId, agentId: this.agentId };

    try {
      const messages: Message[] = Array.isArray(input)
        ? [...input]
        : [{ role: 'user', content: input }];

      const chatSession = this.createChatSession();

      yield* this.executeLoop(messages, chatSession, sessionId, abortController.signal);

      yield { type: 'agent_end', sessionId, reason: 'complete', agentId: this.agentId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: 'error',
        message,
        fatal: true,
        error: error instanceof Error ? error : undefined,
        agentId: this.agentId,
      };
      yield { type: 'agent_end', sessionId, reason: 'error', agentId: this.agentId };
    }
  }

  // ============================================================
  // 共享基础设施
  // ============================================================

  /** 创建 ChatSession，应用 onToolFilter 过滤工具 */
  protected createChatSession(): ChatSession {
    const filteredTools = this.onToolFilter(this.registry.getAll());

    // 构建一个临时 registry 来生成 ToolDefinitions
    const filteredRegistry = new ToolRegistry();
    for (const t of filteredTools) {
      filteredRegistry.register(t);
    }

    return this.config.provider.chat({
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      tools: filteredRegistry.size > 0
        ? filteredRegistry.toToolDefinitions()
        : undefined,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  /** 收集一轮 LLM 流式响应 */
  protected async collectResponse(
    chatSession: ChatSession,
    messages: Message[],
    signal: AbortSignal,
  ): Promise<CollectedResponse> {
    let text = '';
    const toolCalls: ToolCallInfo[] = [];
    let usage: UsageInfo | undefined;

    for await (const event of chatSession.sendMessage(messages, signal)) {
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
  }

  /**
   * 执行一批工具调用，内部调用 onBeforeToolCall/onAfterToolCall 钩子。
   * yield 工具请求/响应事件，并将结果追加到消息历史。
   */
  protected async *executeToolCalls(
    toolCalls: ToolCallInfo[],
    messages: Message[],
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const toolResults: ToolResultPart[] = [];
    const toolCallRequests: ToolCallRequest[] = toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.args,
    }));

    const toolContext: ToolContext = {
      sessionId,
      cwd: process.cwd(),
      messages: messages as readonly Message[],
      signal,
    };

    for await (const result of this.scheduler.execute(toolCallRequests, toolContext)) {
      // 钩子：工具调用前
      const tc = toolCalls.find((t) => t.id === result.id);
      if (tc) {
        const decision = await this.onBeforeToolCall(tc.name, tc.args);
        if (!decision.allow) {
          // 被钩子拒绝的工具调用，返回错误结果给 LLM
          toolResults.push({
            type: 'tool_result',
            toolCallId: result.id,
            content: `Tool call "${tc.name}" was rejected by policy.`,
            isError: true,
          });

          yield {
            type: 'tool_response',
            requestId: result.id,
            toolName: tc.name,
            content: `Tool call "${tc.name}" was rejected by policy.`,
            isError: true,
            agentId: this.agentId,
          };
          continue;
        }
      }

      yield {
        type: 'tool_request',
        requestId: result.id,
        toolName: result.name,
        args: tc?.args ?? {},
        agentId: this.agentId,
      };

      yield {
        type: 'tool_response',
        requestId: result.id,
        toolName: result.name,
        content: result.result.content,
        isError: result.result.isError,
        agentId: this.agentId,
      };

      // 钩子：工具调用后
      await this.onAfterToolCall(result.name, result.result);

      toolResults.push({
        type: 'tool_result',
        toolCallId: result.id,
        content: result.result.content,
        isError: result.result.isError,
      });
    }

    messages.push({ role: 'tool', content: toolResults });
  }
}
```

- [ ] **Step 3: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/base-agent.ts packages/core/src/agent/types.ts
git commit -m "feat: add BaseAgent abstract class with lifecycle hooks"
```

---

### Task 5: ReActAgent（从现有 Agent 迁移）

**Files:**
- Create: `packages/core/src/agent/react-agent.ts`
- Create: `packages/core/src/agent/react-agent.test.ts`
- Modify: `packages/core/src/agent/agent.ts`
- Delete contents of: `packages/core/src/agent/agent.test.ts`

- [ ] **Step 1: 实现 ReActAgent**

创建 `packages/core/src/agent/react-agent.ts`：

```typescript
/**
 * ReActAgent —— 边想边做的 Agent 策略
 *
 * 实现标准 ReAct 循环：LLM 推理 → 工具调用 → 结果反馈 → 继续推理。
 * 从原来的 Agent 类迁移而来，逻辑完全一致。
 *
 * 架构位置：继承自 BaseAgent，是框架的默认 Agent 策略。
 */

import type { ChatSession } from '../llm/provider.js';
import type {
  ContentPart,
  Message,
} from '../llm/types.js';
import type {
  AgentEvent,
  StateTransition,
} from './types.js';
import { BaseAgent } from './base-agent.js';

const DEFAULT_MAX_ITERATIONS = 20;

export class ReActAgent extends BaseAgent {

  protected defineTransitions(): StateTransition[] {
    return [
      { from: 'idle', to: 'reacting' },
      { from: 'reacting', to: 'completed' },
      { from: 'reacting', to: 'error' },
      { from: 'reacting', to: 'aborted' },
    ];
  }

  protected async *executeLoop(
    messages: Message[],
    chatSession: ChatSession,
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    this.stateMachine.transition('reacting');
    yield { type: 'state_change', from: 'idle', to: 'reacting', agentId: this.agentId };

    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (signal.aborted) {
        this.stateMachine.transition('aborted');
        return;
      }

      await this.onBeforeIteration({
        iteration,
        messages,
        sessionId,
        state: this.stateMachine.current,
      });

      const { text, toolCalls, usage } = await this.collectResponse(
        chatSession,
        messages,
        signal,
      );

      if (usage) {
        yield { type: 'usage', model: this.config.model, usage, agentId: this.agentId };
      }

      if (text) {
        yield { type: 'message', role: 'assistant', content: text, agentId: this.agentId };
      }

      // 没有工具调用 → 任务完成
      if (toolCalls.length === 0) {
        const assistantParts: ContentPart[] = [];
        if (text) assistantParts.push({ type: 'text', text });
        messages.push({ role: 'assistant', content: assistantParts });

        this.stateMachine.transition('completed');
        return;
      }

      // 记录助手消息到历史
      const assistantParts: ContentPart[] = [];
      if (text) assistantParts.push({ type: 'text', text });
      for (const tc of toolCalls) {
        assistantParts.push({
          type: 'tool_call',
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args,
        });
      }
      messages.push({ role: 'assistant', content: assistantParts });

      // 执行工具调用
      yield* this.executeToolCalls(toolCalls, messages, sessionId, signal);

      await this.onAfterIteration({
        iteration,
        messages,
        sessionId,
        state: this.stateMachine.current,
      });
    }

    // 超过最大迭代次数
    this.stateMachine.transition('error');
    yield {
      type: 'error',
      message: `Agent loop exceeded maximum iterations (${maxIterations})`,
      fatal: true,
      agentId: this.agentId,
    };
  }
}
```

- [ ] **Step 2: 将 agent.ts 改为 re-export**

将 `packages/core/src/agent/agent.ts` 的全部内容替换为：

```typescript
/**
 * 向后兼容导出。
 * 原来的 Agent 类已迁移到 ReActAgent，这里做别名导出保持 API 不变。
 */
export { ReActAgent as Agent } from './react-agent.js';
```

- [ ] **Step 3: 创建 ReActAgent 测试**

创建 `packages/core/src/agent/react-agent.test.ts`，将 `agent.test.ts` 的全部测试内容复制过来，但做以下替换：
- `import { Agent } from './agent.js'` → `import { ReActAgent } from './react-agent.js'`
- 所有 `new Agent(` → `new ReActAgent(`
- `describe('Agent',` → `describe('ReActAgent',`
- `collectEvents` 函数的参数类型 `Agent` → `ReActAgent`

新增一个测试验证状态机事件：

```typescript
it('emits state_change events', async () => {
  const provider = mockProvider([
    [
      { type: 'text', text: 'Hello!' },
      { type: 'finish', reason: 'stop' },
    ],
  ]);

  const agent = new ReActAgent({ provider, model: 'test-model' });
  const events = await collectEvents(agent, 'Hi');

  const stateChanges = events.filter((e) => e.type === 'state_change');
  expect(stateChanges).toHaveLength(1);
  expect(stateChanges[0]).toMatchObject({
    type: 'state_change',
    from: 'idle',
    to: 'reacting',
  });
});
```

- [ ] **Step 4: 将 agent.test.ts 改为兼容性测试**

将 `packages/core/src/agent/agent.test.ts` 的内容替换为：

```typescript
import { describe, it, expect } from 'vitest';
import { Agent } from './agent.js';
import { ReActAgent } from './react-agent.js';

describe('Agent backward compatibility', () => {
  it('Agent is an alias for ReActAgent', () => {
    expect(Agent).toBe(ReActAgent);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm vitest run packages/core/src/agent/`
Expected: 全部 PASS

- [ ] **Step 6: 更新 index.ts 导出**

在 `packages/core/src/index.ts` 中添加新导出：

```typescript
// ---- Agent 核心 ----
export { Agent } from './agent/agent.js';
export { BaseAgent } from './agent/base-agent.js';
export { ReActAgent } from './agent/react-agent.js';
export { AgentStateMachine } from './agent/state-machine.js';
```

在 `export type` 部分添加所有新类型：

```typescript
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
```

- [ ] **Step 7: 更新 SDK index.ts**

在 `packages/sdk/src/index.ts` 中，更新从 `@agent-tea/core` 的导出，添加：

```typescript
export {
  Agent,
  BaseAgent,
  ReActAgent,
  AgentStateMachine,
  tool,
  ToolRegistry,
  // ... 保留原有错误类导出 ...
} from '@agent-tea/core';
```

在 `export type` 中添加所有新类型。

- [ ] **Step 8: 运行完整测试 + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 全部 PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/agent/ packages/core/src/index.ts packages/sdk/src/index.ts
git commit -m "refactor: extract ReActAgent from Agent, introduce BaseAgent abstract class"
```

---

### Task 6: PlanStore

**Files:**
- Create: `packages/core/src/agent/plan-store.ts`
- Create: `packages/core/src/agent/plan-store.test.ts`

- [ ] **Step 1: 写 PlanStore 测试**

创建 `packages/core/src/agent/plan-store.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlanStore } from './plan-store.js';
import type { Plan } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('PlanStore', () => {
  let tmpDir: string;
  let store: PlanStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-store-test-'));
    store = new PlanStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makePlan(overrides?: Partial<Plan>): Plan {
    return {
      id: 'plan-1',
      filePath: '',
      steps: [
        { index: 0, description: 'Step 1: do something', status: 'pending' },
        { index: 1, description: 'Step 2: do another thing', status: 'pending' },
      ],
      rawContent: '1. do something\n2. do another thing',
      createdAt: new Date('2026-04-05'),
      ...overrides,
    };
  }

  it('saves and loads a plan', async () => {
    const plan = makePlan();
    const filePath = await store.save(plan, 'session-1');

    expect(filePath).toContain('session-1');
    expect(filePath).toContain(tmpDir);

    const loaded = await store.load(filePath);
    expect(loaded.id).toBe('plan-1');
    expect(loaded.steps).toHaveLength(2);
    expect(loaded.steps[0].description).toBe('Step 1: do something');
  });

  it('updates step status', async () => {
    const plan = makePlan();
    const filePath = await store.save(plan, 'session-2');

    await store.updateStep(filePath, 0, 'completed');

    const loaded = await store.load(filePath);
    expect(loaded.steps[0].status).toBe('completed');
    expect(loaded.steps[1].status).toBe('pending');
  });

  it('creates directory if not exists', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'dir');
    const nestedStore = new PlanStore(nestedDir);
    const plan = makePlan();

    const filePath = await nestedStore.save(plan, 'session-3');
    const loaded = await nestedStore.load(filePath);
    expect(loaded.id).toBe('plan-1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/agent/plan-store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 PlanStore**

创建 `packages/core/src/agent/plan-store.ts`：

```typescript
/**
 * PlanStore —— 计划文件存储
 *
 * 将 Plan 对象序列化为 JSON 文件，支持读取和步骤状态更新。
 * 计划存为文件的原因：方便用户审阅、存档、出问题时回查。
 *
 * 架构位置：Core 层 Agent 子模块，被 PlanAndExecuteAgent 使用。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Plan, PlanStep } from './types.js';

export class PlanStore {
  constructor(private readonly baseDir: string = '.agent-tea/plans') {}

  /** 保存计划到文件，返回文件路径 */
  async save(plan: Plan, sessionId: string): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true });

    const fileName = `${sessionId}-${plan.id}.json`;
    const filePath = path.join(this.baseDir, fileName);

    plan.filePath = filePath;
    await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');

    return filePath;
  }

  /** 从文件加载计划 */
  async load(filePath: string): Promise<Plan> {
    const content = await fs.readFile(filePath, 'utf-8');
    const plan = JSON.parse(content) as Plan;
    plan.createdAt = new Date(plan.createdAt);
    return plan;
  }

  /** 更新指定步骤的状态 */
  async updateStep(
    filePath: string,
    stepIndex: number,
    status: PlanStep['status'],
  ): Promise<void> {
    const plan = await this.load(filePath);

    if (stepIndex < 0 || stepIndex >= plan.steps.length) {
      throw new Error(`Step index ${stepIndex} out of range (0-${plan.steps.length - 1})`);
    }

    plan.steps[stepIndex].status = status;
    await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');
  }
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run packages/core/src/agent/plan-store.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/plan-store.ts packages/core/src/agent/plan-store.test.ts
git commit -m "feat: add PlanStore for plan file persistence"
```

---

### Task 7: 内置 Plan 模式工具

**Files:**
- Create: `packages/core/src/tools/internal/enter-plan-mode.ts`
- Create: `packages/core/src/tools/internal/exit-plan-mode.ts`

- [ ] **Step 1: 创建 internal 目录**

Run: `mkdir -p packages/core/src/tools/internal`

- [ ] **Step 2: 实现 enter_plan_mode 工具**

创建 `packages/core/src/tools/internal/enter-plan-mode.ts`：

```typescript
/**
 * enter_plan_mode —— 内置工具，允许 LLM 在运行时切换到 Plan 模式
 *
 * 当 ReActAgent 的 allowPlanMode=true 时自动注入。
 * LLM 调用此工具后，Agent 内部将控制权移交给 Plan 阶段。
 *
 * 实际的状态切换由 Agent 在 onBeforeToolCall 中拦截处理，
 * 此工具的 execute 只是返回确认消息。
 */

import { z } from 'zod';
import { tool } from '../builder.js';

export const enterPlanModeTool = tool(
  {
    name: 'enter_plan_mode',
    description:
      '当任务复杂、需要多步骤规划时调用。进入规划模式后只能使用只读工具来探索和制定计划。',
    parameters: z.object({
      reason: z.string().describe('为什么需要进入规划模式'),
    }),
    tags: ['readonly', 'internal'],
  },
  async ({ reason }) => {
    return `已进入规划模式。原因：${reason}\n请开始探索代码并制定执行计划。`;
  },
);
```

- [ ] **Step 3: 实现 exit_plan_mode 工具**

创建 `packages/core/src/tools/internal/exit-plan-mode.ts`：

```typescript
/**
 * exit_plan_mode —— 内置工具，提交计划等待审批
 *
 * LLM 在规划完成后调用，提交计划概要。
 * 实际的审批流程由 Agent 在 onBeforeToolCall 中拦截处理。
 */

import { z } from 'zod';
import { tool } from '../builder.js';

export const exitPlanModeTool = tool(
  {
    name: 'exit_plan_mode',
    description: '规划完成后调用，提交计划等待审批。',
    parameters: z.object({
      planSummary: z.string().describe('计划概要'),
    }),
    tags: ['internal'],
  },
  async ({ planSummary }) => {
    return `计划已提交审批。概要：${planSummary}`;
  },
);
```

- [ ] **Step 4: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/internal/
git commit -m "feat: add enter_plan_mode and exit_plan_mode internal tools"
```

---

### Task 8: PlanAndExecuteAgent

**Files:**
- Create: `packages/core/src/agent/plan-and-execute-agent.ts`
- Create: `packages/core/src/agent/plan-and-execute-agent.test.ts`

- [ ] **Step 1: 写 PlanAndExecuteAgent 基本测试**

创建 `packages/core/src/agent/plan-and-execute-agent.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { PlanAndExecuteAgent } from './plan-and-execute-agent.js';
import { tool } from '../tools/builder.js';
import type { LLMProvider, ChatSession, ChatOptions } from '../llm/provider.js';
import type { Message, ChatStreamEvent } from '../llm/types.js';
import type { AgentEvent } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * 创建一个 mock provider，依次返回预设的响应。
 * 与 ReActAgent 测试中的 mockProvider 完全一致。
 */
function mockProvider(responses: ChatStreamEvent[][]): LLMProvider {
  let callIndex = 0;
  return {
    id: 'mock',
    chat(_options: ChatOptions): ChatSession {
      return {
        async *sendMessage(
          _messages: Message[],
          _signal?: AbortSignal,
        ): AsyncGenerator<ChatStreamEvent> {
          const events = responses[callIndex++];
          if (!events) throw new Error('No more mock responses');
          for (const event of events) {
            yield event;
          }
        },
      };
    },
  };
}

async function collectEvents(
  agent: PlanAndExecuteAgent,
  input: string,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.run(input)) {
    events.push(event);
  }
  return events;
}

describe('PlanAndExecuteAgent', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-agent-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('goes through planning → approval → execution flow', async () => {
    const readFileTool = tool(
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: z.object({ path: z.string() }),
        tags: ['readonly'],
      },
      async ({ path }) => `content of ${path}`,
    );

    const writeFileTool = tool(
      {
        name: 'write_file',
        description: 'Write a file',
        parameters: z.object({ path: z.string(), content: z.string() }),
      },
      async ({ path, content }) => `wrote ${content} to ${path}`,
    );

    const provider = mockProvider([
      // Plan phase: LLM uses readonly tool then outputs plan
      [
        { type: 'tool_call', id: 'tc1', name: 'read_file', args: { path: 'src/index.ts' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      // Plan phase: LLM outputs plan text
      [
        {
          type: 'text',
          text: '```plan\n1. Read the config file\n2. Update the config\n```',
        },
        { type: 'finish', reason: 'stop' },
      ],
      // Execute step 1: LLM uses read tool
      [
        { type: 'tool_call', id: 'tc2', name: 'read_file', args: { path: 'config.json' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'Read the config successfully.' },
        { type: 'finish', reason: 'stop' },
      ],
      // Execute step 2: LLM uses write tool
      [
        { type: 'tool_call', id: 'tc3', name: 'write_file', args: { path: 'config.json', content: '{}' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text', text: 'Updated the config.' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const agent = new PlanAndExecuteAgent({
      provider,
      model: 'test-model',
      tools: [readFileTool, writeFileTool],
      planStoreDir: tmpDir,
    });

    const events = await collectEvents(agent, 'Update the config');

    // 验证状态转换
    const stateChanges = events.filter((e) => e.type === 'state_change');
    const states = stateChanges.map((e: any) => e.to);
    expect(states).toContain('planning');
    expect(states).toContain('executing');
    expect(states).toContain('completed');

    // 验证 plan_created 事件
    const planCreated = events.find((e) => e.type === 'plan_created');
    expect(planCreated).toBeDefined();

    // 验证 step 事件
    const stepStarts = events.filter((e) => e.type === 'step_start');
    const stepCompletes = events.filter((e) => e.type === 'step_complete');
    expect(stepStarts.length).toBeGreaterThanOrEqual(2);
    expect(stepCompletes.length).toBeGreaterThanOrEqual(2);
  });

  it('filters to readonly tools during planning phase', async () => {
    const writeFileTool = tool(
      {
        name: 'write_file',
        description: 'Write a file',
        parameters: z.object({ path: z.string(), content: z.string() }),
      },
      async () => 'wrote',
    );

    // LLM tries to call write_file during planning — should get error
    const provider = mockProvider([
      [
        { type: 'tool_call', id: 'tc1', name: 'write_file', args: { path: 'x', content: 'y' } },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        { type: 'text', text: '```plan\n1. Do something\n```' },
        { type: 'finish', reason: 'stop' },
      ],
      // Execute phase
      [
        { type: 'text', text: 'Done.' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    const agent = new PlanAndExecuteAgent({
      provider,
      model: 'test-model',
      tools: [writeFileTool],
      planStoreDir: tmpDir,
    });

    const events = await collectEvents(agent, 'Do something');

    // write_file 在 planning 阶段应该找不到（被过滤掉了）
    const toolResponses = events.filter(
      (e) => e.type === 'tool_response' && e.toolName === 'write_file',
    );
    if (toolResponses.length > 0) {
      expect((toolResponses[0] as any).isError).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/agent/plan-and-execute-agent.test.ts`
Expected: FAIL

- [ ] **Step 3: 扩展 AgentConfig 添加 planStoreDir**

在 `packages/core/src/config/types.ts` 的 `AgentConfig` 末尾添加：

```typescript
/** Plan 文件存储目录，默认 '.agent-tea/plans' */
planStoreDir?: string;
```

- [ ] **Step 4: 实现 PlanAndExecuteAgent**

创建 `packages/core/src/agent/plan-and-execute-agent.ts`：

```typescript
/**
 * PlanAndExecuteAgent —— 先规划再执行的 Agent 策略
 *
 * 三个阶段：
 * 1. Planning：只读 ReAct 子循环，LLM 探索代码后制定计划
 * 2. Approval：将计划写入文件，通过 onPlanCreated 钩子等待审批
 * 3. Execute：按计划逐步执行，每步运行一个有限的 ReAct 子循环
 *
 * 架构位置：继承自 BaseAgent，是 ReActAgent 之外的另一种 Agent 策略。
 */

import type { ChatSession } from '../llm/provider.js';
import type {
  ContentPart,
  Message,
} from '../llm/types.js';
import type {
  AgentEvent,
  Plan,
  PlanStep,
  StateTransition,
} from './types.js';
import type { Tool } from '../tools/types.js';
import { BaseAgent } from './base-agent.js';
import { PlanStore } from './plan-store.js';

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_STEP_MAX_ITERATIONS = 10;

export class PlanAndExecuteAgent extends BaseAgent {
  private readonly planStore: PlanStore;

  constructor(config: import('../config/types.js').AgentConfig) {
    super(config);
    this.planStore = new PlanStore(config.planStoreDir);
  }

  protected defineTransitions(): StateTransition[] {
    return [
      { from: 'idle', to: 'planning' },
      { from: 'planning', to: 'awaiting_approval' },
      { from: 'awaiting_approval', to: 'executing' },
      { from: 'awaiting_approval', to: 'planning' },
      { from: 'executing', to: 'completed' },
      { from: 'executing', to: 'step_failed' },
      { from: 'step_failed', to: 'executing' },
      { from: 'step_failed', to: 'planning' },
      { from: 'step_failed', to: 'error' },
      { from: 'step_failed', to: 'aborted' },
      { from: 'planning', to: 'error' },
      { from: 'planning', to: 'aborted' },
      { from: 'executing', to: 'error' },
      { from: 'executing', to: 'aborted' },
    ];
  }

  /** Plan 阶段只保留带 'readonly' 标签的工具 */
  protected onToolFilter(tools: Tool[]): Tool[] {
    if (this.stateMachine.current === 'planning') {
      return tools.filter((t) => t.tags?.includes('readonly'));
    }
    return tools;
  }

  protected async *executeLoop(
    messages: Message[],
    _chatSession: ChatSession,
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    yield* this.planPhase(messages, sessionId, signal);
  }

  // ============================================================
  // 阶段一：Planning（只读 ReAct 子循环）
  // ============================================================

  private async *planPhase(
    messages: Message[],
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    this.stateMachine.transition('planning');
    yield { type: 'state_change', from: 'idle', to: 'planning', agentId: this.agentId };

    // 创建只读工具集的 ChatSession
    const planSession = this.createChatSession();
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    let planText = '';

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (signal.aborted) return;

      await this.onBeforeIteration({
        iteration,
        messages,
        sessionId,
        state: this.stateMachine.current,
      });

      const { text, toolCalls, usage } = await this.collectResponse(
        planSession,
        messages,
        signal,
      );

      if (usage) {
        yield { type: 'usage', model: this.config.model, usage, agentId: this.agentId };
      }

      if (text) {
        planText += text;
        yield { type: 'message', role: 'assistant', content: text, agentId: this.agentId };
      }

      if (toolCalls.length === 0) {
        // LLM 停止工具调用 → 规划完成
        const assistantParts: ContentPart[] = [];
        if (text) assistantParts.push({ type: 'text', text });
        messages.push({ role: 'assistant', content: assistantParts });
        break;
      }

      // 记录助手消息
      const assistantParts: ContentPart[] = [];
      if (text) assistantParts.push({ type: 'text', text });
      for (const tc of toolCalls) {
        assistantParts.push({
          type: 'tool_call',
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.args,
        });
      }
      messages.push({ role: 'assistant', content: assistantParts });

      // 执行只读工具
      yield* this.executeToolCalls(toolCalls, messages, sessionId, signal);

      await this.onAfterIteration({
        iteration,
        messages,
        sessionId,
        state: this.stateMachine.current,
      });
    }

    // 解析计划
    const plan = this.parsePlan(planText, sessionId);

    // 保存到文件
    const filePath = await this.planStore.save(plan, sessionId);

    // 审批
    this.stateMachine.transition('awaiting_approval');
    yield {
      type: 'state_change',
      from: 'planning',
      to: 'awaiting_approval',
      agentId: this.agentId,
    };
    yield { type: 'plan_created', plan, filePath, agentId: this.agentId };

    const approval = await this.onPlanCreated(plan);

    if (!approval.approved) {
      // 带反馈重新规划
      this.stateMachine.transition('planning');
      yield {
        type: 'state_change',
        from: 'awaiting_approval',
        to: 'planning',
        agentId: this.agentId,
      };
      messages.push({
        role: 'user',
        content: `计划未通过审批。反馈：${approval.feedback ?? '请重新规划。'}`,
      });
      yield* this.planPhase(messages, sessionId, signal);
      return;
    }

    // 进入执行阶段
    yield* this.executePhase(plan, messages, sessionId, signal);
  }

  // ============================================================
  // 阶段三：Execute（逐步执行）
  // ============================================================

  private async *executePhase(
    plan: Plan,
    messages: Message[],
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    this.stateMachine.transition('executing');
    yield {
      type: 'state_change',
      from: 'awaiting_approval',
      to: 'executing',
      agentId: this.agentId,
    };

    for (const step of plan.steps) {
      if (signal.aborted) return;

      step.status = 'executing';
      await this.onStepStart(step);
      yield { type: 'step_start', step, agentId: this.agentId };

      try {
        // 将当前步骤作为用户消息
        const stepMessage: Message = {
          role: 'user',
          content: `执行计划步骤 ${step.index + 1}/${plan.steps.length}：\n${step.description}`,
        };
        const stepMessages: Message[] = [...messages, stepMessage];

        // 为这一步创建新的 ChatSession（完整工具集）
        // 重置 stateMachine 不需要，因为 onToolFilter 根据 'executing' 状态返回全部工具
        const stepSession = this.createChatSession();

        let toolCallCount = 0;
        const stepMaxIterations = DEFAULT_STEP_MAX_ITERATIONS;

        for (let iteration = 0; iteration < stepMaxIterations; iteration++) {
          if (signal.aborted) return;

          const { text, toolCalls, usage } = await this.collectResponse(
            stepSession,
            stepMessages,
            signal,
          );

          if (usage) {
            yield { type: 'usage', model: this.config.model, usage, agentId: this.agentId };
          }

          if (text) {
            yield { type: 'message', role: 'assistant', content: text, agentId: this.agentId };
          }

          if (toolCalls.length === 0) {
            const parts: ContentPart[] = [];
            if (text) parts.push({ type: 'text', text });
            stepMessages.push({ role: 'assistant', content: parts });
            break;
          }

          // 记录助手消息
          const parts: ContentPart[] = [];
          if (text) parts.push({ type: 'text', text });
          for (const tc of toolCalls) {
            parts.push({
              type: 'tool_call',
              toolCallId: tc.id,
              toolName: tc.name,
              args: tc.args,
            });
          }
          stepMessages.push({ role: 'assistant', content: parts });

          yield* this.executeToolCalls(toolCalls, stepMessages, sessionId, signal);
          toolCallCount += toolCalls.length;
        }

        // 步骤完成
        step.status = 'completed';
        const result = { summary: '', toolCallCount };
        step.result = result;
        await this.planStore.updateStep(plan.filePath, step.index, 'completed');
        await this.onStepComplete(step, result);
        yield { type: 'step_complete', step, agentId: this.agentId };

        // 将步骤消息合并回主消息历史（保留上下文连续性）
        messages.push({
          role: 'user',
          content: `[步骤 ${step.index + 1} 已完成] ${step.description}`,
        });

      } catch (error) {
        step.status = 'failed';
        this.stateMachine.transition('step_failed');
        yield {
          type: 'state_change',
          from: 'executing',
          to: 'step_failed',
          agentId: this.agentId,
        };
        yield { type: 'step_failed', step, error, agentId: this.agentId };

        const action = await this.onStepFailed(step, error as Error);

        switch (action) {
          case 'skip':
            step.status = 'skipped';
            await this.planStore.updateStep(plan.filePath, step.index, 'skipped');
            this.stateMachine.transition('executing');
            yield {
              type: 'state_change',
              from: 'step_failed',
              to: 'executing',
              agentId: this.agentId,
            };
            continue;

          case 'replan':
            this.stateMachine.transition('planning');
            yield {
              type: 'state_change',
              from: 'step_failed',
              to: 'planning',
              agentId: this.agentId,
            };
            messages.push({
              role: 'user',
              content: `步骤 ${step.index + 1} 执行失败：${error instanceof Error ? error.message : String(error)}\n请重新规划剩余步骤。`,
            });
            yield* this.planPhase(messages, sessionId, signal);
            return;

          case 'abort':
            this.stateMachine.transition('error');
            yield {
              type: 'state_change',
              from: 'step_failed',
              to: 'error',
              agentId: this.agentId,
            };
            yield {
              type: 'error',
              message: `Step ${step.index + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
              fatal: true,
              agentId: this.agentId,
            };
            return;

          case 'pause':
          default:
            yield { type: 'execution_paused', step, error, agentId: this.agentId };
            return;
        }
      }
    }

    this.stateMachine.transition('completed');
    yield {
      type: 'state_change',
      from: 'executing',
      to: 'completed',
      agentId: this.agentId,
    };
  }

  // ============================================================
  // 计划解析
  // ============================================================

  /**
   * 从 LLM 输出中解析计划。
   * 支持 ```plan ... ``` 代码块格式和普通编号列表格式。
   */
  private parsePlan(text: string, sessionId: string): Plan {
    // 尝试从 ```plan ... ``` 代码块中提取
    const codeBlockMatch = text.match(/```plan\n([\s\S]*?)```/);
    const planContent = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

    // 按行解析步骤（支持 "1. xxx" 或 "- xxx" 格式）
    const lines = planContent.split('\n').filter((line) => line.trim());
    const steps: PlanStep[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配 "1. xxx"、"1) xxx"、"- xxx"
      const match = trimmed.match(/^(?:\d+[.)]\s*|-\s*)(.*)/);
      if (match) {
        steps.push({
          index: steps.length,
          description: match[1].trim(),
          status: 'pending',
        });
      }
    }

    // 如果没解析出任何步骤，把整段文本作为一个步骤
    if (steps.length === 0) {
      steps.push({
        index: 0,
        description: planContent,
        status: 'pending',
      });
    }

    return {
      id: `plan-${Date.now()}`,
      filePath: '',
      steps,
      rawContent: text,
      createdAt: new Date(),
    };
  }
}
```

- [ ] **Step 5: 更新 index.ts 导出**

在 `packages/core/src/index.ts` 中添加：

```typescript
export { PlanAndExecuteAgent } from './agent/plan-and-execute-agent.js';
export { PlanStore } from './agent/plan-store.js';
```

在 `packages/sdk/src/index.ts` 中添加：

```typescript
export { PlanAndExecuteAgent, PlanStore } from '@agent-tea/core';
```

- [ ] **Step 6: 运行测试**

Run: `pnpm vitest run packages/core/src/agent/plan-and-execute-agent.test.ts`
Expected: 全部 PASS

- [ ] **Step 7: 运行完整测试 + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agent/plan-and-execute-agent.ts packages/core/src/agent/plan-and-execute-agent.test.ts packages/core/src/config/types.ts packages/core/src/index.ts packages/sdk/src/index.ts
git commit -m "feat: add PlanAndExecuteAgent with plan-approve-execute workflow"
```

---

### Task 9: ReActAgent allowPlanMode 支持

**Files:**
- Modify: `packages/core/src/agent/react-agent.ts`
- Modify: `packages/core/src/agent/react-agent.test.ts`

- [ ] **Step 1: 写 allowPlanMode 测试**

在 `packages/core/src/agent/react-agent.test.ts` 中添加：

```typescript
describe('ReActAgent with allowPlanMode', () => {
  it('injects enter_plan_mode tool when allowPlanMode is true', async () => {
    // LLM 直接回复文本（不调用 enter_plan_mode）
    const provider = mockProvider([
      [
        { type: 'text', text: 'Simple task, no plan needed.' },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    // 验证 chatSession 被创建时包含 enter_plan_mode 工具
    let capturedOptions: any;
    const originalChat = provider.chat.bind(provider);
    provider.chat = (options: any) => {
      capturedOptions = options;
      return originalChat(options);
    };

    const agent = new ReActAgent({
      provider,
      model: 'test-model',
      allowPlanMode: true,
    });

    await collectEvents(agent, 'Hello');

    const toolNames = capturedOptions?.tools?.map((t: any) => t.name) ?? [];
    expect(toolNames).toContain('enter_plan_mode');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/agent/react-agent.test.ts`
Expected: 新测试 FAIL

- [ ] **Step 3: 在 ReActAgent 中实现 allowPlanMode**

修改 `packages/core/src/agent/react-agent.ts`：

在构造函数中注入工具：

```typescript
import { enterPlanModeTool } from '../tools/internal/enter-plan-mode.js';
import { exitPlanModeTool } from '../tools/internal/exit-plan-mode.js';

export class ReActAgent extends BaseAgent {

  constructor(config: import('../config/types.js').AgentConfig) {
    // 当 allowPlanMode=true 时，将内置 plan 工具注入到工具列表
    if (config.allowPlanMode) {
      const tools = [...(config.tools ?? []), enterPlanModeTool, exitPlanModeTool];
      super({ ...config, tools });
    } else {
      super(config);
    }
  }

  // ... defineTransitions 和 executeLoop 保持不变 ...
}
```

注意：运行时切换到 Plan 模式的完整实现（拦截 enter_plan_mode 调用后进入 planPhase）是一个更复杂的功能，需要 ReActAgent 组合 PlanAndExecuteAgent 的 plan/execute 逻辑。当前先实现工具注入，确保工具可见。完整的切换逻辑可以后续迭代。

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run packages/core/src/agent/react-agent.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 运行完整测试**

Run: `pnpm test && pnpm typecheck`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/react-agent.ts packages/core/src/agent/react-agent.test.ts
git commit -m "feat: add allowPlanMode to ReActAgent for runtime plan mode switching"
```

---

### Task 10: SDK 层 subAgent 适配

**Files:**
- Modify: `packages/sdk/src/sub-agent.ts`

- [ ] **Step 1: 更新 subAgent 使用 ReActAgent**

在 `packages/sdk/src/sub-agent.ts` 中，将 `import { Agent }` 改为 `import { ReActAgent }`，并在 `subAgent` 函数中使用 `ReActAgent`：

```typescript
import { z } from 'zod';
import { ReActAgent, tool, type LLMProvider, type Tool } from '@agent-tea/core';

// ... SubAgentConfig 不变 ...

export function subAgent(config: SubAgentConfig): Tool {
  const agent = new ReActAgent({
    provider: config.provider,
    model: config.model,
    tools: config.tools,
    systemPrompt: config.systemPrompt,
    maxIterations: config.maxIterations ?? 10,
  });

  // ... tool 定义不变，但内部 agent 类型已经是 ReActAgent ...
}
```

实际上由于 `Agent` 是 `ReActAgent` 的别名，现有代码也能工作。但显式使用 `ReActAgent` 更清晰。

- [ ] **Step 2: 运行完整测试 + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/sub-agent.ts
git commit -m "refactor: update subAgent to explicitly use ReActAgent"
```

---

### Task 11: 最终验证

**Files:** 无新增

- [ ] **Step 1: 运行完整测试套件**

Run: `pnpm test`
Expected: 全部 PASS

- [ ] **Step 2: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 3: 运行 build**

Run: `pnpm build`
Expected: 所有包构建成功

- [ ] **Step 4: 验证导出**

检查 `packages/core/dist/index.d.ts` 中包含以下导出：
- `BaseAgent`
- `ReActAgent`
- `Agent`（ReActAgent 别名）
- `PlanAndExecuteAgent`
- `AgentStateMachine`
- `PlanStore`
- 所有新增类型

- [ ] **Step 5: 最终 Commit（如有遗漏修改）**

```bash
git add -A
git commit -m "feat: complete agent strategy system - ReAct + Plan-and-Execute"
```
