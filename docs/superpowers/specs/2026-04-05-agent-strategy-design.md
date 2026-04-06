# Agent 策略体系设计

## 概述

为 t-agent 框架引入 BaseAgent 抽象类体系，支持 ReAct 和 Plan-and-Execute 两种 Agent 策略，并预留 Multi-Agent 和 WorkflowGraph 的扩展空间。

## 目标

- 将现有 `Agent` 重构为 `BaseAgent` + `ReActAgent`，行为完全不变
- 新增 `PlanAndExecuteAgent`，支持"先规划 → 审批 → 逐步执行"
- 新增 `AgentStateMachine`，显式管理 Agent 的阶段状态
- 支持 LLM 运行时通过工具切换到 Plan 模式
- 为二期的 Orchestrator 和 WorkflowGraph 预留扩展点

## 架构分层

```
┌─────────────────────────────────────────────────┐
│  Layer 3: Workflow Orchestration (二期)          │
│  Orchestrator (编排者 Agent)                     │
│  WorkflowGraph (DAG/有环图流程编排)               │
├──────────────────────────────────────────────────┤
│  Layer 2: Agent State Machine (一期)             │
│  AgentStateMachine                               │
│  显式管理 Agent 阶段状态和合法转换                  │
├──────────────────────────────────────────────────┤
│  Layer 1: Agent Strategies (一期)                │
│  BaseAgent (abstract)                            │
│  ├── ReActAgent (现有逻辑迁移)                    │
│  └── PlanAndExecuteAgent (新增)                  │
├──────────────────────────────────────────────────┤
│  Layer 0: Core (已有，基本不动)                   │
│  LLMProvider / ChatSession / ToolRegistry /      │
│  Scheduler / ToolExecutor                        │
└──────────────────────────────────────────────────┘
```

## 一、AgentStateMachine

### 职责

记录 Agent 当前处于哪个阶段，并限制只能按合法路径转换。非法转换抛异常。

### 状态定义

```typescript
type AgentState =
  | 'idle'
  | 'reacting'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'step_failed'
  | 'completed'
  | 'error'
  | 'aborted';
```

### 实现

```typescript
interface StateTransition {
  from: AgentState | AgentState[];
  to: AgentState;
  guard?: () => boolean;
}

class AgentStateMachine {
  private state: AgentState = 'idle';
  private readonly transitions: StateTransition[];
  private readonly listeners: Array<(from: AgentState, to: AgentState) => void>;

  transition(to: AgentState): void;
  get current(): AgentState;
  onTransition(listener: (from: AgentState, to: AgentState) => void): () => void;
}
```

### 新增事件

```typescript
interface StateChangeEvent {
  type: 'state_change';
  from: AgentState;
  to: AgentState;
  agentId?: string;
}
```

## 二、BaseAgent 抽象类

### 职责

承担所有 Agent 的共同基础设施（创建会话、调用 LLM、执行工具、事件分发），将循环逻辑留给子类。

### 定义

```typescript
abstract class BaseAgent {
  protected readonly config: AgentConfig;
  protected readonly registry: ToolRegistry;
  protected readonly scheduler: Scheduler;
  protected readonly stateMachine: AgentStateMachine;

  constructor(config: AgentConfig);

  // ---- 子类必须实现 ----
  protected abstract defineTransitions(): StateTransition[];
  protected abstract executeLoop(
    messages: Message[],
    chatSession: ChatSession,
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent>;

  // ---- 生命周期钩子（默认空实现）----
  protected async onBeforeIteration(ctx: IterationContext): Promise<void>;
  protected async onAfterIteration(ctx: IterationContext): Promise<void>;
  protected onToolFilter(tools: Tool[]): Tool[];
  protected async onPlanCreated(plan: Plan): Promise<PlanApproval>;
  protected async onStepStart(step: PlanStep): Promise<void>;
  protected async onStepComplete(step: PlanStep, result: StepResult): Promise<void>;
  protected async onStepFailed(step: PlanStep, error: Error): Promise<StepFailureAction>;
  protected async onBeforeToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolCallDecision>;
  protected async onAfterToolCall(toolName: string, result: ToolResult): Promise<void>;

  // ---- 共享基础设施 ----
  async *run(input: string | Message[], signal?: AbortSignal): AsyncGenerator<AgentEvent>;
  protected async collectResponse(chatSession: ChatSession, messages: Message[], signal: AbortSignal): Promise<CollectedResponse>;
  protected async *executeToolCalls(toolCalls: ToolCallInfo[], messages: Message[], sessionId: string, signal: AbortSignal): AsyncGenerator<AgentEvent>;
  protected createChatSession(): ChatSession;

  // ---- Plan 相关共享逻辑（供 ReActAgent(allowPlanMode) 和 PlanAndExecuteAgent 复用）----
  protected async *runPlanPhase(messages: Message[], sessionId: string, signal: AbortSignal): AsyncGenerator<AgentEvent>;
  protected async *runExecutePhase(plan: Plan, messages: Message[], sessionId: string, signal: AbortSignal): AsyncGenerator<AgentEvent>;
}
```

### 关键类型

```typescript
interface IterationContext {
  iteration: number;
  messages: readonly Message[];
  sessionId: string;
  state: AgentState;
}

interface CollectedResponse {
  text: string;
  toolCalls: ToolCallInfo[];
  usage?: UsageInfo;
}

interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface ToolCallDecision {
  allow: boolean;
  modifiedArgs?: Record<string, unknown>;
}

interface PlanApproval {
  approved: boolean;
  feedback?: string;
}

type StepFailureAction = 'pause' | 'skip' | 'replan' | 'abort';
```

### AgentConfig 扩展

```typescript
interface AgentConfig {
  provider: LLMProvider;
  model: string;
  tools?: Tool[];
  systemPrompt?: string;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;

  // 新增
  agentId?: string;
  strategy?: 'react' | 'plan-and-execute';
  allowPlanMode?: boolean;
}
```

### Tool 接口扩展

```typescript
interface Tool<TParams = Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly parameters: ZodType<TParams>;
  readonly tags?: string[];  // 新增：如 ['readonly']、['destructive']
  execute(params: TParams, context: ToolContext): Promise<ToolResult | string>;
}
```

### 向后兼容

```typescript
export { ReActAgent as Agent } from './react-agent.js';
```

## 三、ReActAgent

将当前 `Agent.run()` 的循环逻辑平移到 `ReActAgent.executeLoop()`，行为完全不变。

### 状态转换

```
idle → reacting → completed
                → error
                → aborted
```

当 `allowPlanMode=true` 时，额外注入 `enter_plan_mode` / `exit_plan_mode` 工具。LLM 调用 `enter_plan_mode` 后，内部调用 `this.runPlanPhase()` 进入规划流程。

## 四、PlanAndExecuteAgent

### 状态转换

```
idle → planning → awaiting_approval → executing → completed
         ↑                                │
         │              ┌─────────────────┘
         │              ↓
         └────────── step_failed → error

任何状态 → aborted (AbortSignal)
任何状态 → error (未捕获异常)
```

### 三个阶段

#### 阶段一：Planning（只读 ReAct 子循环）

1. 状态机转入 `planning`
2. 通过 `onToolFilter` 过滤为只读工具集（只保留 `tags` 包含 `'readonly'` 的工具）
3. 运行 ReAct 子循环，LLM 可以调用只读工具探索代码
4. LLM 输出结构化计划
5. 解析为 `Plan` 对象

#### 阶段二：审批

1. 状态机转入 `awaiting_approval`
2. 将计划写入文件（通过 `PlanStore`）
3. 发出 `plan_created` 事件
4. 调用 `onPlanCreated` 钩子等待审批
5. 审批通过 → 进入执行阶段
6. 审批拒绝 → 带反馈回到规划阶段

#### 阶段三：Execute（逐步执行）

1. 状态机转入 `executing`
2. 重新创建 ChatSession（完整工具集）
3. 逐步将 `PlanStep.description` 作为用户消息发给 LLM
4. 每步运行一个有限迭代的 ReAct 子循环
5. 步骤完成 → 发出 `step_complete` 事件，更新计划文件
6. 步骤失败 → 状态机转入 `step_failed`，调用 `onStepFailed` 钩子，由消费方决定：
   - `pause`：发出 `execution_paused` 事件，停止执行
   - `skip`：跳过此步骤，继续下一步
   - `replan`：回到规划阶段重新规划
   - `abort`：终止执行

### Plan 相关类型

```typescript
interface Plan {
  id: string;
  filePath: string;
  steps: PlanStep[];
  rawContent: string;
  createdAt: Date;
}

interface PlanStep {
  index: number;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
  result?: StepResult;
}

interface StepResult {
  summary: string;
  toolCallCount: number;
  events: AgentEvent[];
}
```

### PlanStore

```typescript
class PlanStore {
  constructor(private readonly baseDir: string = '.t-agent/plans');

  async save(plan: Plan, sessionId: string): Promise<string>;
  async load(filePath: string): Promise<Plan>;
  async updateStep(filePath: string, stepIndex: number, status: PlanStep['status']): Promise<void>;
}
```

### 新增事件类型

```typescript
interface PlanCreatedEvent {
  type: 'plan_created';
  plan: Plan;
  filePath: string;
  agentId?: string;
}

interface StepStartEvent {
  type: 'step_start';
  step: PlanStep;
  agentId?: string;
}

interface StepCompleteEvent {
  type: 'step_complete';
  step: PlanStep;
  agentId?: string;
}

interface StepFailedEvent {
  type: 'step_failed';
  step: PlanStep;
  error: unknown;
  agentId?: string;
}

interface ExecutionPausedEvent {
  type: 'execution_paused';
  step: PlanStep;
  error: unknown;
  agentId?: string;
}
```

## 五、运行时策略切换

### 内置工具

当 `ReActAgent` 的 `allowPlanMode=true` 时，自动注入：

- `enter_plan_mode`：LLM 调用后触发 `runPlanPhase()`
- `exit_plan_mode`：LLM 调用后提交计划进入审批

这两个工具标记 `tags: ['readonly', 'internal']` 和 `tags: ['internal']`。

### 触发机制

`ReActAgent.onBeforeToolCall` 拦截 `enter_plan_mode` 调用，将控制权移交给 `this.runPlanPhase()`。执行完成后回到 ReAct 循环继续。

## 六、二期预留

### 一期实际改动

1. `AgentConfig` 加 `agentId?: string`
2. 所有 `AgentEvent` 加 `agentId?: string`

### 二期方向

- **Orchestrator**：继承 `BaseAgent`，内置 `dispatch_task` / `collect_results` 工具，管理多个 worker Agent
- **WorkflowGraph**：定义节点（Agent 或函数）和边（条件跳转），构建 DAG/有环图编排复杂流程

## 七、文件结构变更

```
packages/core/src/
  agent/
    base-agent.ts          # 新增：BaseAgent 抽象类
    react-agent.ts         # 重命名自 agent.ts：ReActAgent
    plan-and-execute-agent.ts  # 新增：PlanAndExecuteAgent
    state-machine.ts       # 新增：AgentStateMachine
    plan-store.ts          # 新增：PlanStore
    types.ts               # 修改：新增事件类型、Plan 类型
  tools/
    types.ts               # 修改：Tool 接口加 tags 字段
    builder.ts             # 修改：tool() 工厂支持 tags
    enter-plan-mode.ts     # 新增：内置工具
    exit-plan-mode.ts      # 新增：内置工具
  config/
    types.ts               # 修改：AgentConfig 新增字段
  index.ts                 # 修改：新增导出
```

## 八、兼容性

- `import { Agent } from '@t-agent/core'` 继续可用，是 `ReActAgent` 的别名
- 不指定 `strategy` 时默认行为与现有完全一致
- `Tool` 接口新增的 `tags` 为可选字段，现有工具定义无需修改
- 所有新增事件类型是 `AgentEvent` 联合类型的扩展，现有事件消费代码不受影响
