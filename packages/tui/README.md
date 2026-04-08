# @agent-tea/tui

Agent-Tea 终端 UI 框架 — 基于 [Ink](https://github.com/vadimdemedes/ink)（React for CLI）构建，为 AI Agent 提供开箱即用的终端交互界面。

## 安装

```bash
pnpm add @agent-tea/tui @agent-tea/sdk
# 按需安装 Provider
pnpm add @agent-tea/provider-openai
```

## 快速上手

### 一行启动完整 TUI

```typescript
import { Agent, tool, z } from '@agent-tea/sdk';
import { AgentTUI } from '@agent-tea/tui';
import { OpenAIProvider } from '@agent-tea/provider-openai';
import { render } from 'ink';
import React from 'react';

const provider = new OpenAIProvider();
const agent = new Agent({
    provider,
    model: 'gpt-4o',
    tools: [/* ... */],
});

render(<AgentTUI agent={agent} initialQuery="你好" />);
```

`AgentTUI` 封装了完整的交互循环：Agent 事件消费 → 消息渲染 → 用户输入 → 工具审批 → 状态展示。

### 仅使用数据层（无 UI）

如果你需要自己构建 UI，可以只用事件收集器：

```typescript
import { createEventCollector } from '@agent-tea/tui';

const collector = createEventCollector(agent, '你的问题');

collector.on('snapshot', (snapshot) => {
    console.log('状态:', snapshot.status);
    console.log('历史:', snapshot.history.length, '条');
    console.log('流式文本:', snapshot.streaming);
});

collector.on('done', (snapshot) => {
    console.log('完成，总 token:', snapshot.usage);
});

await collector.start();
```

## 核心 API 概览

### 四层架构

```
Runner 层     AgentTUI / DefaultLayout / Composer     完整应用
Components    UserMessage / AgentMessage / ToolCallCard / ...    UI 组件
Hooks 层      useAgentEvents / useApproval               状态管理
Adapter 层    EventCollector / AgentSnapshot              事件 → 状态
```

每层可独立使用，按需引入。

### AgentTUI — 主组件

```typescript
<AgentTUI
    agent={agent}                          // 必填：Agent 实例
    initialQuery="你好"                     // 可选：启动时自动发送
    components={{ statusBar: MyStatusBar }} // 可选：替换默认组件
    layout={MyLayout}                      // 可选：自定义布局
    onApproval={(req) => customDialog(req)} // 可选：自定义审批处理
    onComplete={(snapshot) => done(snapshot)} // 可选：完成回调
/>
```

### AgentSnapshot — 状态模型

EventCollector 将 Agent 事件流聚合为统一的状态快照：

```typescript
interface AgentSnapshot {
    status: AgentStatus;
    // 'idle' | 'thinking' | 'tool_executing' | 'waiting_approval'
    // | 'completed' | 'error' | 'aborted'
    history: HistoryItem[]; // 对话历史
    streaming: string | null; // 当前流式文本
    pendingApproval: ApprovalRequestEvent | null;
    usage: { inputTokens: number; outputTokens: number };
    error: string | null;
}
```

`HistoryItem` 是可辨识联合（`MessageItem | ToolCallItem | PlanItem | ErrorItem`）。

### React Hooks

```typescript
import { useAgentEvents, useApproval } from '@agent-tea/tui';

function MyApp({ agent }) {
    const { snapshot, run, abort } = useAgentEvents(agent);
    const { approve, reject, modifyAndApprove } = useApproval(agent);

    // snapshot 自动随事件更新
    // run(query) 发起新对话
    // abort() 中止当前执行
}
```

### 可替换组件

所有 UI 组件可通过 `components` prop 替换：

| 组件             | Props                                                    | 说明         |
| ---------------- | -------------------------------------------------------- | ------------ |
| `UserMessage`    | `{ content }`                                            | 用户消息     |
| `AgentMessage`   | `{ content, streaming? }`                                | Agent 回复   |
| `ToolCallCard`   | `{ requestId, name, args, result, isError, durationMs }` | 工具调用卡片 |
| `ApprovalDialog` | `{ request, onApprove, onReject }`                       | 审批对话框   |
| `PlanView`       | `{ steps }`                                              | 执行计划视图 |
| `ErrorMessage`   | `{ message, fatal }`                                     | 错误提示     |
| `StatusBar`      | `{ status, usage }`                                      | 状态栏       |

```typescript
import { AgentTUI } from '@agent-tea/tui';

// 只替换想修改的组件，其余用默认实现
<AgentTUI
    agent={agent}
    components={{
        statusBar: ({ status, usage }) => (
            <Text>状态: {status} | Tokens: {usage.inputTokens + usage.outputTokens}</Text>
        ),
    }}
/>
```

### 自定义布局

提供 `layout` prop 完全控制界面排版：

```typescript
const MyLayout = ({ history, statusBar, composer, approval }) => (
    <Box flexDirection="column">
        {statusBar}
        <Box flexGrow={1}>{history}</Box>
        {approval}
        {composer}
    </Box>
);

<AgentTUI agent={agent} layout={MyLayout} />
```

`LayoutProps`：`{ history, statusBar, composer, approval: ReactNode | null }`

### 键盘快捷键

| 快捷键    | 功能         |
| --------- | ------------ |
| `Ctrl+C`  | 优雅中止     |
| `Y` / `y` | 批准工具调用 |
| `N` / `n` | 拒绝工具调用 |

## 配置选项

### AgentTUI Props

| Prop           | 类型                                 | 必填 | 说明                 |
| -------------- | ------------------------------------ | ---- | -------------------- |
| `agent`        | `BaseAgent`                          | 是   | Agent 实例           |
| `initialQuery` | `string`                             | 否   | 启动时自动发送的查询 |
| `components`   | `Partial<ComponentMap>`              | 否   | 替换默认组件         |
| `layout`       | `React.ComponentType<LayoutProps>`   | 否   | 自定义布局组件       |
| `onApproval`   | `(req) => Promise<ApprovalDecision>` | 否   | 自定义审批处理       |
| `onComplete`   | `(snapshot) => void`                 | 否   | 完成回调             |

### Composer Props

| Prop          | 类型                      | 必填 | 说明                                 |
| ------------- | ------------------------- | ---- | ------------------------------------ |
| `onSubmit`    | `(query: string) => void` | 是   | 提交回调                             |
| `disabled`    | `boolean`                 | 否   | 禁用输入                             |
| `placeholder` | `string`                  | 否   | 占位文本（默认 `'输入你的问题...'`） |

## 重新导出

`@agent-tea/tui` 重新导出 `@agent-tea/sdk` 的全部 API，可作为唯一导入源：

```typescript
// 一个 import 搞定
import { Agent, tool, z, AgentTUI, useAgentEvents } from '@agent-tea/tui';
```

## 要求

- Node.js >= 20.0.0
- React >= 18.0.0

## License

MIT
