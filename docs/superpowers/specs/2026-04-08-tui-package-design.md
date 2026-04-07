# TUI 包设计

## 概述

新建 `@agent-tea/tui` 包，为 agent-tea 框架提供终端 UI 应用开发能力。定位是**应用框架**——帮开发者用 agent-tea 构建终端 AI 应用（类似 Codex、Gemini CLI）。

基于 Ink（React for Terminal），提供四层能力：

1. **Adapter 层**——事件流转结构化状态（纯 JS，不依赖 React）
2. **Hooks 层**——Adapter 的 React 封装
3. **Components 层**——可组合的 Ink 组件库
4. **Runner 层**——开箱即用的 `<AgentTUI>` 一站式组件

## 1. 包结构与依赖

### 目录结构

```
packages/tui/
├── src/
│   ├── adapter/                # 事件适配层（纯逻辑，无 UI 依赖）
│   │   ├── event-collector.ts  # createEventCollector() 工厂函数
│   │   ├── types.ts            # AgentSnapshot, HistoryItem 等状态类型
│   │   └── index.ts
│   ├── hooks/                  # Ink/React hooks
│   │   ├── useAgentEvents.ts   # 核心 hook，包装 event-collector → React state
│   │   ├── useApproval.ts      # 审批状态管理
│   │   └── index.ts
│   ├── components/             # Ink 组件
│   │   ├── AgentMessage.tsx    # 流式文本渲染（支持 Markdown）
│   │   ├── UserMessage.tsx     # 用户输入展示
│   │   ├── ToolCallCard.tsx    # 工具调用卡片（折叠/展开，错误高亮）
│   │   ├── ApprovalDialog.tsx  # 审批确认框（Y/N/修改参数）
│   │   ├── PlanView.tsx        # 计划步骤列表（带状态标记）
│   │   ├── StatusBar.tsx       # 底部状态栏（Agent 状态 + token 用量）
│   │   ├── History.tsx         # 滚动历史列表，自动映射 HistoryItem → 组件
│   │   └── index.ts
│   ├── runner/                 # 默认 TUI Runner
│   │   ├── AgentTUI.tsx        # <AgentTUI agent={agent} /> 一站式组件
│   │   ├── DefaultLayout.tsx   # 默认布局（历史 + 状态栏 + 输入框）
│   │   ├── Composer.tsx        # 用户输入框
│   │   └── index.ts
│   └── index.ts                # 统一导出
├── package.json                # @agent-tea/tui
└── tsup.config.ts
```

### 依赖链

```
@agent-tea/core ← @agent-tea/sdk ← @agent-tea/tui ← ink, react
```

`@agent-tea/tui` 是最上层包，依赖 SDK（自动获得 Extension/Skill/SubAgent 等能力）。开发者只需安装 `@agent-tea/tui` 即可使用全部框架功能。

## 2. Adapter 层——事件适配

把 `agent.run()` 的 `AsyncGenerator<AgentEvent>` 转为结构化的可观测状态。这层是纯 JS，不依赖 React/Ink，可在任何 JS 环境使用。

### 核心类型

```typescript
// 历史条目——已完成的事件
type HistoryItem =
    | { type: 'message'; role: 'user' | 'assistant'; content: string }
    | {
          type: 'tool_call';
          name: string;
          args: unknown;
          result: string;
          isError: boolean;
          durationMs: number;
      }
    | { type: 'plan'; steps: PlanStep[] }
    | { type: 'error'; message: string; fatal: boolean };

// Agent 全局状态快照
interface AgentSnapshot {
    status:
        | 'idle'
        | 'thinking'
        | 'tool_executing'
        | 'waiting_approval'
        | 'completed'
        | 'error'
        | 'aborted';
    history: HistoryItem[];
    streaming: string | null; // 正在流式输出的文本片段
    pendingApproval: ApprovalRequest | null;
    usage: { inputTokens: number; outputTokens: number };
    error: string | null;
}
```

### 纯 JS API

```typescript
interface EventCollector {
    on(event: 'snapshot', listener: (snapshot: AgentSnapshot) => void): void;
    on(event: 'done', listener: (snapshot: AgentSnapshot) => void): void;
    start(): Promise<AgentSnapshot>; // 启动并等待完成，返回最终快照
    abort(): void; // 中止执行
}

function createEventCollector(agent: BaseAgent, query: string): EventCollector;
```

**内部实现**：`start()` 内部 `for await (const event of agent.run(query))` 消费事件，每个事件更新内部 snapshot 状态并触发 `'snapshot'` 回调，循环结束触发 `'done'`。

### 事件 → 状态映射规则

| AgentEvent.type              | snapshot 更新                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_start`                | `status = 'thinking'`                                                                                                                              |
| `message` (assistant)        | 追加到 `streaming`；下一个非 message 事件（如 `tool_request`/`agent_end`）到来时，将 `streaming` 内容作为完整消息移入 `history` 并清空 `streaming` |
| `tool_request`               | `status = 'tool_executing'`，创建 pending tool_call                                                                                                |
| `tool_response`              | 补全 tool_call 的 result/durationMs，移入 `history`                                                                                                |
| `approval_request`           | `status = 'waiting_approval'`，设置 `pendingApproval`                                                                                              |
| `usage`                      | 累加 `usage`                                                                                                                                       |
| `error`                      | fatal 时 `status = 'error'`，追加到 `history`                                                                                                      |
| `plan_created`               | 追加 plan 类型 HistoryItem                                                                                                                         |
| `step_start/complete/failed` | 更新 plan 条目中对应 step 的状态                                                                                                                   |
| `agent_end`                  | `status = 'completed'` 或按 reason 设置                                                                                                            |

## 3. Hooks 层

将 Adapter 包装为 React hooks，供 Ink 组件使用。

### useAgentEvents

```typescript
function useAgentEvents(
    agent: BaseAgent,
    query: string | null,
): {
    snapshot: AgentSnapshot;
    run: (query: string) => void; // 手动触发新一轮对话
    abort: () => void;
};
```

内部使用 `createEventCollector`，通过 `useState` 将每次 snapshot 更新转为 Ink 重新渲染。`query` 为 null 时不自动执行，等待调用 `run()`。

### useApproval

```typescript
function useApproval(agent: BaseAgent): {
    pending: ApprovalRequest | null;
    approve: (requestId: string) => void;
    reject: (requestId: string, reason?: string) => void;
    modifyAndApprove: (requestId: string, newArgs: unknown) => void;
};
```

封装 `agent.resolveApproval()` 调用，简化审批交互。

## 4. Components 层——Ink 组件库

所有组件接收 props 渲染，不包含业务逻辑。

### 组件列表

| 组件               | Props                                                         | 职责                                                                        |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `<AgentMessage>`   | `{ content, streaming? }`                                     | 渲染 assistant 文本，`streaming` 时带光标动画，支持 Markdown                |
| `<UserMessage>`    | `{ content }`                                                 | 渲染用户输入                                                                |
| `<ToolCallCard>`   | `{ name, args, result, isError, durationMs, expanded? }`      | 工具调用卡片，折叠/展开参数和结果，错误红色高亮                             |
| `<ApprovalDialog>` | `{ request, onResolve }`                                      | 审批确认框：展示工具名+参数，支持 Y（批准）/ N（拒绝）/ E（编辑参数后批准） |
| `<PlanView>`       | `{ steps }`                                                   | 计划步骤列表，每步带状态图标（⏳/▶/✓/✗）                                    |
| `<StatusBar>`      | `{ status, usage }`                                           | 底部状态栏：显示当前 Agent 状态 + token 消耗                                |
| `<History>`        | `{ items, streaming?, pendingApproval?, onApprovalResolve? }` | 滚动历史列表，自动将 HistoryItem 映射到对应组件                             |

### 组件映射机制

`<History>` 内部通过 `ComponentMap` 决定每种 HistoryItem 用哪个组件渲染：

```typescript
interface ComponentMap {
    message: React.ComponentType<AgentMessageProps>;
    userMessage: React.ComponentType<UserMessageProps>;
    toolCall: React.ComponentType<ToolCallCardProps>;
    approval: React.ComponentType<ApprovalDialogProps>;
    plan: React.ComponentType<PlanViewProps>;
    error: React.ComponentType<ErrorProps>;
}
```

通过 React Context (`ComponentContext`) 注入，开发者可替换任意组件。

## 5. Runner 层——`<AgentTUI>`

一站式组件，组装 hooks + components + 布局 + 输入，开箱即用。

### API

```typescript
interface AgentTUIProps {
    agent: BaseAgent;
    initialQuery?: string; // 跳过首次输入，直接执行
    components?: Partial<ComponentMap>; // 替换内置组件
    layout?: React.ComponentType<LayoutProps>; // 自定义布局
    onApproval?: (req: ApprovalRequest) => Promise<ApprovalDecision>; // 自定义审批处理
    onComplete?: (snapshot: AgentSnapshot) => void; // 会话结束回调
}
```

### 默认布局

```
┌──────────────────────────────────────────┐
│  Agent Tea                   tokens: 1.2k│  ← StatusBar
├──────────────────────────────────────────┤
│  You: 帮我分析 src/ 目录的代码结构       │
│                                          │
│  ▶ readFile("src/index.ts")        0.3s  │  ← ToolCallCard（折叠态）
│  ▶ listDirectory("src/")           0.1s  │
│                                          │
│  Assistant: src/ 目录下有 3 个模块...    │  ← AgentMessage
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← 流式输出中
│                                          │
├──────────────────────────────────────────┤
│  > 输入你的问题...                 ⏎ 发送│  ← Composer
└──────────────────────────────────────────┘
```

### 交互功能

- **多轮对话**：Composer 提交后调 `agent.run()`，结果追加到历史
- **工具卡片折叠/展开**：Tab 或方向键导航，Enter 展开
- **审批弹出**：`approval_request` 事件时自动弹出 ApprovalDialog，Y/N 后继续
- **优雅中止**：Ctrl+C 触发 AbortSignal，Agent 停止后显示 aborted 状态
- **自定义布局**：通过 `layout` prop 传入自定义 LayoutProps 组件

### LayoutProps

```typescript
interface LayoutProps {
    history: React.ReactNode; // <History> 组件实例
    statusBar: React.ReactNode; // <StatusBar> 组件实例
    composer: React.ReactNode; // <Composer> 组件实例
    approval: React.ReactNode | null; // 当前审批对话框（无审批时为 null）
}
```

## 6. Examples 规划

三类场景共存：

### Core 场景（保留现有）

展示底层控制力，手写事件循环：

- `01-minimal-agent` — 最小 Agent + 手动事件消费
- `03-event-stream` — 完整事件类型展示
- `04-hooks` — 钩子系统
- `07-approval` — 审批系统手动处理

### SDK 场景（新增）

展示纯 JS 便利 API，无 UI 依赖：

- `17-event-collector` — 用 `createEventCollector` 收集结果，不写事件循环
- `18-batch-run` — 批量运行多个 query，收集所有结果
- `19-sdk-subagent-collector` — SubAgent + EventCollector 组合

### TUI 场景（新增）

展示终端应用开发：

- `20-tui-minimal` — `<AgentTUI>` 三行代码跑起全屏 TUI
- `21-tui-custom-components` — 自定义 ToolCallCard 和 ApprovalDialog
- `22-tui-custom-layout` — 自定义布局（如双面板：左聊天右工具日志）
- `23-tui-plan-execute` — PlanAndExecuteAgent + TUI（展示计划审批全流程）

## 7. 技术决策

| 决策           | 选择                                   | 理由                                          |
| -------------- | -------------------------------------- | --------------------------------------------- |
| UI 框架        | Ink (React for Terminal)               | TypeScript 生态天然契合，组件可组合，社区成熟 |
| 包定位         | 应用框架                               | 帮开发者构建终端 AI 应用，不只是调试工具      |
| 依赖链         | `core ← sdk ← tui`                     | TUI 是最上层，一个包获得全部能力              |
| Adapter 层独立 | 纯 JS，不依赖 React                    | 支持非 Ink 场景（测试、脚本、其他 UI 框架）   |
| 组件可替换     | React Context + ComponentMap           | 默认开箱即用，需要时任意覆盖                  |
| 审批处理       | 内置 ApprovalDialog，可通过 props 覆盖 | 满足"默认好用，可定制"原则                    |
