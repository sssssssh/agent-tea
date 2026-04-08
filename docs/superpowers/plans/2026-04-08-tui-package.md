# TUI 包实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `@agent-tea/tui` 包，提供 Adapter（事件→状态）、Hooks、Ink 组件库、默认 TUI Runner 四层能力，帮开发者用 agent-tea 构建终端 AI 应用。

**Architecture:** 四层分离——Adapter 层是纯 JS 事件收集器，Hooks 层将其桥接到 React state，Components 层提供可组合的 Ink 组件，Runner 层组装为开箱即用的 `<AgentTUI>`。依赖链：`core ← sdk ← tui ← ink, react`。

**Tech Stack:** TypeScript, Ink 5, React 18, ink-testing-library, vitest

**Spec:** `docs/superpowers/specs/2026-04-08-tui-package-design.md`

---

## 文件结构

### 新建文件

```
packages/tui/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── src/
│   ├── index.ts                          # 统一导出
│   ├── adapter/
│   │   ├── types.ts                      # HistoryItem, AgentSnapshot
│   │   ├── event-collector.ts            # createEventCollector()
│   │   ├── event-collector.test.ts       # Adapter 测试
│   │   └── index.ts
│   ├── hooks/
│   │   ├── use-agent-events.ts           # useAgentEvents hook
│   │   ├── use-approval.ts              # useApproval hook
│   │   └── index.ts
│   ├── components/
│   │   ├── component-context.tsx         # ComponentMap + Context
│   │   ├── UserMessage.tsx
│   │   ├── AgentMessage.tsx
│   │   ├── ToolCallCard.tsx
│   │   ├── ApprovalDialog.tsx
│   │   ├── PlanView.tsx
│   │   ├── StatusBar.tsx
│   │   ├── History.tsx
│   │   ├── components.test.tsx           # 组件测试
│   │   └── index.ts
│   ├── runner/
│   │   ├── Composer.tsx
│   │   ├── DefaultLayout.tsx
│   │   ├── AgentTUI.tsx
│   │   ├── agent-tui.test.tsx            # Runner 测试
│   │   └── index.ts
│   └── test-utils.ts                     # mockAgentRun 测试辅助
examples/
├── 17-event-collector.ts
├── 18-batch-run.ts
├── 19-sdk-subagent-collector.ts
├── 20-tui-minimal.tsx
├── 21-tui-custom-components.tsx
├── 22-tui-custom-layout.tsx
└── 23-tui-plan-execute.tsx
```

### 修改文件

- `pnpm-workspace.yaml` — 无需改，`packages/*` 已覆盖
- `package.json`（根）— 添加 example 脚本

---

## Task 1: 包脚手架

**Files:**

- Create: `packages/tui/package.json`
- Create: `packages/tui/tsconfig.json`
- Create: `packages/tui/tsup.config.ts`
- Create: `packages/tui/src/index.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
    "name": "@agent-tea/tui",
    "version": "0.1.0",
    "description": "Terminal UI framework for agent-tea — build terminal AI applications with Ink components",
    "type": "module",
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "exports": {
        ".": {
            "import": "./dist/index.js",
            "types": "./dist/index.d.ts"
        }
    },
    "files": ["dist"],
    "scripts": {
        "build": "tsup",
        "typecheck": "tsc --noEmit"
    },
    "dependencies": {
        "@agent-tea/sdk": "workspace:*",
        "ink": "^5.1.0",
        "react": "^18.3.1",
        "ink-text-input": "^6.0.0",
        "ink-spinner": "^5.0.0",
        "cli-markdown": "^3.4.0"
    },
    "devDependencies": {
        "@types/react": "^18.3.0",
        "ink-testing-library": "^4.0.0",
        "tsup": "^8.4.0",
        "typescript": "^5.7.0"
    },
    "peerDependencies": {
        "@agent-tea/core": "workspace:*"
    }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "outDir": "dist",
        "rootDir": "src",
        "jsx": "react-jsx"
    },
    "include": ["src/**/*.ts", "src/**/*.tsx"],
    "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
}
```

- [ ] **Step 3: 创建 tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['react', 'ink'],
});
```

- [ ] **Step 4: 创建空的入口文件 src/index.ts**

```typescript
// @agent-tea/tui — Terminal UI framework for agent-tea
```

- [ ] **Step 5: 安装依赖并验证**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm install`
Expected: 成功安装，无报错

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm --filter @agent-tea/tui typecheck`
Expected: 成功（空文件无类型错误）

- [ ] **Step 6: Commit**

```bash
git add packages/tui/
git commit -m "feat(tui): scaffold @agent-tea/tui package"
```

---

## Task 2: Adapter 类型定义

**Files:**

- Create: `packages/tui/src/adapter/types.ts`
- Create: `packages/tui/src/adapter/index.ts`

- [ ] **Step 1: 创建 adapter/types.ts**

```typescript
import type { PlanStep, ApprovalRequestEvent } from '@agent-tea/sdk';

/** 历史条目——已完成的事件 */
export type HistoryItem = MessageItem | ToolCallItem | PlanItem | ErrorItem;

export interface MessageItem {
    type: 'message';
    role: 'user' | 'assistant';
    content: string;
}

export interface ToolCallItem {
    type: 'tool_call';
    requestId: string;
    name: string;
    args: Record<string, unknown>;
    result: string;
    isError: boolean;
    durationMs: number;
}

export interface PlanItem {
    type: 'plan';
    steps: PlanStep[];
}

export interface ErrorItem {
    type: 'error';
    message: string;
    fatal: boolean;
}

/** Agent 执行状态 */
export type AgentStatus =
    | 'idle'
    | 'thinking'
    | 'tool_executing'
    | 'waiting_approval'
    | 'completed'
    | 'error'
    | 'aborted';

/** Agent 全局状态快照——每个事件更新后产出新快照 */
export interface AgentSnapshot {
    status: AgentStatus;
    history: HistoryItem[];
    streaming: string | null;
    pendingApproval: ApprovalRequestEvent | null;
    usage: { inputTokens: number; outputTokens: number };
    error: string | null;
}

/** 创建初始空快照 */
export function createInitialSnapshot(): AgentSnapshot {
    return {
        status: 'idle',
        history: [],
        streaming: null,
        pendingApproval: null,
        usage: { inputTokens: 0, outputTokens: 0 },
        error: null,
    };
}
```

- [ ] **Step 2: 创建 adapter/index.ts**

```typescript
export {
    type HistoryItem,
    type MessageItem,
    type ToolCallItem,
    type PlanItem,
    type ErrorItem,
} from './types.js';
export { type AgentStatus, type AgentSnapshot, createInitialSnapshot } from './types.js';
```

- [ ] **Step 3: 验证类型检查**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm --filter @agent-tea/tui typecheck`
Expected: 成功

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/adapter/
git commit -m "feat(tui): add Adapter layer type definitions"
```

---

## Task 3: EventCollector 实现

**Files:**

- Create: `packages/tui/src/test-utils.ts`
- Create: `packages/tui/src/adapter/event-collector.ts`
- Create: `packages/tui/src/adapter/event-collector.test.ts`

- [ ] **Step 1: 创建测试辅助工具 test-utils.ts**

提供 `mockAgentRun()`，模拟 `agent.run()` 产出预定义的事件序列：

```typescript
import type { AgentEvent, BaseAgent } from '@agent-tea/sdk';

/**
 * 创建一个模拟 agent，其 run() 方法按顺序 yield 给定事件。
 * 用于测试 EventCollector 和 Ink 组件。
 */
export function mockAgentRun(events: AgentEvent[]): Pick<BaseAgent, 'run' | 'resolveApproval'> {
    const approvalResolvers = new Map<string, (decision: unknown) => void>();

    return {
        async *run() {
            for (const event of events) {
                yield event;
                // 如果是审批事件，暂停等待 resolveApproval
                if (event.type === 'approval_request') {
                    await new Promise<void>((resolve) => {
                        approvalResolvers.set(event.requestId, () => resolve());
                    });
                }
            }
        },
        resolveApproval(requestId: string) {
            const resolver = approvalResolvers.get(requestId);
            if (resolver) {
                resolver(undefined);
                approvalResolvers.delete(requestId);
            }
        },
    };
}
```

- [ ] **Step 2: 写 EventCollector 的 failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEventCollector } from './event-collector.js';
import { mockAgentRun } from '../test-utils.js';
import type { AgentEvent } from '@agent-tea/sdk';

describe('createEventCollector', () => {
    const basicEvents: AgentEvent[] = [
        { type: 'agent_start', sessionId: 's1' },
        { type: 'message', role: 'assistant', content: '你好' },
        { type: 'usage', model: 'gpt-4o', usage: { inputTokens: 10, outputTokens: 5 } },
        { type: 'agent_end', sessionId: 's1', reason: 'complete' },
    ];

    it('should return final snapshot on start()', async () => {
        const agent = mockAgentRun(basicEvents);
        const collector = createEventCollector(agent as any, '你好');
        const snapshot = await collector.start();

        expect(snapshot.status).toBe('completed');
        expect(snapshot.history).toHaveLength(1);
        expect(snapshot.history[0]).toEqual({
            type: 'message',
            role: 'assistant',
            content: '你好',
        });
        expect(snapshot.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('should emit snapshot events', async () => {
        const agent = mockAgentRun(basicEvents);
        const collector = createEventCollector(agent as any, '你好');
        const snapshots: any[] = [];
        collector.on('snapshot', (s) => snapshots.push({ ...s }));
        await collector.start();

        // agent_start + message + usage + agent_end = 4 snapshots
        expect(snapshots.length).toBe(4);
        expect(snapshots[0].status).toBe('thinking');
    });

    it('should handle tool request/response pair', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'tool_request', requestId: 'r1', toolName: 'readFile', args: { path: 'a.ts' } },
            {
                type: 'tool_response',
                requestId: 'r1',
                toolName: 'readFile',
                content: 'file content',
            },
            { type: 'message', role: 'assistant', content: '读完了' },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, '读文件');
        const snapshot = await collector.start();

        expect(snapshot.history).toHaveLength(2); // tool_call + message
        const toolCall = snapshot.history[0];
        expect(toolCall.type).toBe('tool_call');
        if (toolCall.type === 'tool_call') {
            expect(toolCall.name).toBe('readFile');
            expect(toolCall.result).toBe('file content');
            expect(toolCall.isError).toBe(false);
        }
    });

    it('should handle error events', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'error', message: 'something broke', fatal: true },
            { type: 'agent_end', sessionId: 's1', reason: 'error' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, '失败');
        const snapshot = await collector.start();

        expect(snapshot.status).toBe('error');
        expect(snapshot.error).toBe('something broke');
        expect(snapshot.history).toHaveLength(1);
        expect(snapshot.history[0]).toEqual({
            type: 'error',
            message: 'something broke',
            fatal: true,
        });
    });

    it('should handle plan events', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            {
                type: 'plan_created',
                plan: {
                    id: 'p1',
                    filePath: '/tmp/plan.json',
                    steps: [
                        { index: 0, description: 'Step 1', status: 'pending' },
                        { index: 1, description: 'Step 2', status: 'pending' },
                    ],
                    rawContent: '',
                    createdAt: new Date(),
                },
                filePath: '/tmp/plan.json',
            },
            { type: 'step_start', step: { index: 0, description: 'Step 1', status: 'executing' } },
            {
                type: 'step_complete',
                step: {
                    index: 0,
                    description: 'Step 1',
                    status: 'completed',
                    result: { summary: 'done', toolCallCount: 1 },
                },
            },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, '计划');
        const snapshot = await collector.start();

        const planItem = snapshot.history.find((h) => h.type === 'plan');
        expect(planItem).toBeDefined();
        if (planItem?.type === 'plan') {
            expect(planItem.steps[0].status).toBe('completed');
        }
    });

    it('should flush streaming text when non-message event arrives', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'message', role: 'assistant', content: '正在思考' },
            { type: 'tool_request', requestId: 'r1', toolName: 'grep', args: { pattern: 'foo' } },
            { type: 'tool_response', requestId: 'r1', toolName: 'grep', content: 'found' },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, 'test');
        const snapshots: any[] = [];
        collector.on('snapshot', (s) => snapshots.push({ ...s, history: [...s.history] }));
        await collector.start();

        // message 事件时 streaming = '正在思考'
        const afterMessage = snapshots[1];
        expect(afterMessage.streaming).toBe('正在思考');

        // tool_request 到来时，streaming 内容 flush 到 history
        const afterToolReq = snapshots[2];
        expect(afterToolReq.streaming).toBeNull();
        expect(afterToolReq.history[0]).toEqual({
            type: 'message',
            role: 'assistant',
            content: '正在思考',
        });
    });

    it('should support abort()', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'message', role: 'assistant', content: '长回复...' },
            { type: 'agent_end', sessionId: 's1', reason: 'abort' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, 'test');
        // abort 不阻塞，只是设置信号
        collector.abort();
        const snapshot = await collector.start();
        // agent_end reason='abort' 应设置 status
        expect(snapshot.status).toBe('aborted');
    });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/adapter/event-collector.test.ts`
Expected: FAIL — `event-collector.js` 不存在

- [ ] **Step 4: 实现 EventCollector**

```typescript
import type { BaseAgent, AgentEvent } from '@agent-tea/sdk';
import { type AgentSnapshot, type ToolCallItem, createInitialSnapshot } from './types.js';

type SnapshotListener = (snapshot: AgentSnapshot) => void;
type DoneListener = (snapshot: AgentSnapshot) => void;

export interface EventCollector {
    on(event: 'snapshot', listener: SnapshotListener): void;
    on(event: 'done', listener: DoneListener): void;
    start(): Promise<AgentSnapshot>;
    abort(): void;
}

export function createEventCollector(agent: Pick<BaseAgent, 'run'>, query: string): EventCollector {
    const snapshotListeners: SnapshotListener[] = [];
    const doneListeners: DoneListener[] = [];
    const abortController = new AbortController();

    let snapshot = createInitialSnapshot();
    // 追踪正在进行的 tool call（requestId → 开始时间）
    let pendingToolCalls = new Map<
        string,
        { name: string; args: Record<string, unknown>; startTime: number }
    >();

    function emit() {
        for (const listener of snapshotListeners) {
            listener(snapshot);
        }
    }

    function flushStreaming() {
        if (snapshot.streaming !== null) {
            snapshot = {
                ...snapshot,
                history: [
                    ...snapshot.history,
                    { type: 'message', role: 'assistant', content: snapshot.streaming },
                ],
                streaming: null,
            };
        }
    }

    function handleEvent(event: AgentEvent) {
        switch (event.type) {
            case 'agent_start':
                snapshot = { ...snapshot, status: 'thinking' };
                break;

            case 'message':
                if (event.role === 'assistant') {
                    snapshot = {
                        ...snapshot,
                        streaming: (snapshot.streaming ?? '') + event.content,
                    };
                } else {
                    snapshot = {
                        ...snapshot,
                        history: [
                            ...snapshot.history,
                            { type: 'message', role: 'user', content: event.content },
                        ],
                    };
                }
                break;

            case 'tool_request':
                flushStreaming();
                pendingToolCalls.set(event.requestId, {
                    name: event.toolName,
                    args: event.args,
                    startTime: Date.now(),
                });
                snapshot = { ...snapshot, status: 'tool_executing' };
                break;

            case 'tool_response': {
                const pending = pendingToolCalls.get(event.requestId);
                const durationMs = pending ? Date.now() - pending.startTime : 0;
                const toolCall: ToolCallItem = {
                    type: 'tool_call',
                    requestId: event.requestId,
                    name: event.toolName,
                    args: pending?.args ?? {},
                    result: event.content,
                    isError: event.isError ?? false,
                    durationMs,
                };
                pendingToolCalls.delete(event.requestId);
                snapshot = {
                    ...snapshot,
                    status: 'thinking',
                    history: [...snapshot.history, toolCall],
                };
                break;
            }

            case 'approval_request':
                flushStreaming();
                snapshot = {
                    ...snapshot,
                    status: 'waiting_approval',
                    pendingApproval: event,
                };
                break;

            case 'usage':
                snapshot = {
                    ...snapshot,
                    usage: {
                        inputTokens: snapshot.usage.inputTokens + (event.usage.inputTokens ?? 0),
                        outputTokens: snapshot.usage.outputTokens + (event.usage.outputTokens ?? 0),
                    },
                };
                break;

            case 'error':
                snapshot = {
                    ...snapshot,
                    status: event.fatal ? 'error' : snapshot.status,
                    error: event.fatal ? event.message : snapshot.error,
                    history: [
                        ...snapshot.history,
                        { type: 'error', message: event.message, fatal: event.fatal },
                    ],
                };
                break;

            case 'plan_created':
                flushStreaming();
                snapshot = {
                    ...snapshot,
                    history: [...snapshot.history, { type: 'plan', steps: [...event.plan.steps] }],
                };
                break;

            case 'step_start':
            case 'step_complete':
            case 'step_failed': {
                // 找到最后一个 plan item 并更新对应 step
                const historyClone = [...snapshot.history];
                for (let i = historyClone.length - 1; i >= 0; i--) {
                    const item = historyClone[i];
                    if (item.type === 'plan') {
                        const steps = item.steps.map((s) =>
                            s.index === event.step.index ? { ...event.step } : s,
                        );
                        historyClone[i] = { ...item, steps };
                        break;
                    }
                }
                snapshot = { ...snapshot, history: historyClone };
                break;
            }

            case 'agent_end':
                flushStreaming();
                snapshot = {
                    ...snapshot,
                    status:
                        event.reason === 'complete'
                            ? 'completed'
                            : event.reason === 'abort'
                              ? 'aborted'
                              : event.reason === 'error'
                                ? 'error'
                                : 'completed',
                    pendingApproval: null,
                };
                break;

            case 'state_change':
            case 'execution_paused':
                // 不影响 snapshot 主状态
                break;
        }

        emit();
    }

    return {
        on(event: string, listener: (...args: any[]) => void) {
            if (event === 'snapshot') snapshotListeners.push(listener as SnapshotListener);
            if (event === 'done') doneListeners.push(listener as DoneListener);
        },

        async start(): Promise<AgentSnapshot> {
            for await (const event of agent.run(query, abortController.signal)) {
                handleEvent(event);
            }
            for (const listener of doneListeners) {
                listener(snapshot);
            }
            return snapshot;
        },

        abort() {
            abortController.abort();
        },
    };
}
```

- [ ] **Step 5: 更新 adapter/index.ts 导出**

```typescript
export {
    type HistoryItem,
    type MessageItem,
    type ToolCallItem,
    type PlanItem,
    type ErrorItem,
} from './types.js';
export { type AgentStatus, type AgentSnapshot, createInitialSnapshot } from './types.js';
export { createEventCollector, type EventCollector } from './event-collector.js';
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/adapter/event-collector.test.ts`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/adapter/ packages/tui/src/test-utils.ts
git commit -m "feat(tui): implement EventCollector with full event-to-snapshot mapping"
```

---

## Task 4: React Hooks

**Files:**

- Create: `packages/tui/src/hooks/use-agent-events.ts`
- Create: `packages/tui/src/hooks/use-approval.ts`
- Create: `packages/tui/src/hooks/index.ts`

- [ ] **Step 1: 实现 useAgentEvents hook**

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';
import type { BaseAgent } from '@agent-tea/sdk';
import { createEventCollector, type EventCollector } from '../adapter/index.js';
import { type AgentSnapshot, createInitialSnapshot } from '../adapter/types.js';

export function useAgentEvents(
    agent: Pick<BaseAgent, 'run'>,
    initialQuery: string | null = null,
): {
    snapshot: AgentSnapshot;
    run: (query: string) => void;
    abort: () => void;
} {
    const [snapshot, setSnapshot] = useState<AgentSnapshot>(createInitialSnapshot);
    const collectorRef = useRef<EventCollector | null>(null);

    const run = useCallback(
        (query: string) => {
            // 前一轮如果还在跑，先中止
            collectorRef.current?.abort();

            const collector = createEventCollector(agent, query);
            collectorRef.current = collector;

            collector.on('snapshot', (s) => setSnapshot(s));
            collector.start(); // 不 await，异步跑
        },
        [agent],
    );

    const abort = useCallback(() => {
        collectorRef.current?.abort();
    }, []);

    // initialQuery 不为 null 时自动触发
    useEffect(() => {
        if (initialQuery !== null) {
            run(initialQuery);
        }
    }, []); // 仅首次挂载触发

    return { snapshot, run, abort };
}
```

- [ ] **Step 2: 实现 useApproval hook**

```typescript
import { useCallback } from 'react';
import type { BaseAgent, ApprovalDecision } from '@agent-tea/sdk';

export function useApproval(agent: Pick<BaseAgent, 'resolveApproval'>): {
    approve: (requestId: string) => void;
    reject: (requestId: string, reason?: string) => void;
    modifyAndApprove: (requestId: string, newArgs: Record<string, unknown>) => void;
} {
    const approve = useCallback(
        (requestId: string) => {
            agent.resolveApproval(requestId, { approved: true });
        },
        [agent],
    );

    const reject = useCallback(
        (requestId: string, reason?: string) => {
            agent.resolveApproval(requestId, { approved: false, reason });
        },
        [agent],
    );

    const modifyAndApprove = useCallback(
        (requestId: string, newArgs: Record<string, unknown>) => {
            agent.resolveApproval(requestId, { approved: true, modifiedArgs: newArgs });
        },
        [agent],
    );

    return { approve, reject, modifyAndApprove };
}
```

- [ ] **Step 3: 创建 hooks/index.ts**

```typescript
export { useAgentEvents } from './use-agent-events.js';
export { useApproval } from './use-approval.js';
```

- [ ] **Step 4: 验证类型检查**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm --filter @agent-tea/tui typecheck`
Expected: 成功

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/hooks/
git commit -m "feat(tui): add useAgentEvents and useApproval hooks"
```

---

## Task 5: ComponentContext 与基础展示组件

**Files:**

- Create: `packages/tui/src/components/component-context.tsx`
- Create: `packages/tui/src/components/UserMessage.tsx`
- Create: `packages/tui/src/components/AgentMessage.tsx`
- Create: `packages/tui/src/components/StatusBar.tsx`
- Create: `packages/tui/src/components/components.test.tsx`

- [ ] **Step 1: 写组件测试（先写 failing test）**

```tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { UserMessage } from './UserMessage.js';
import { AgentMessage } from './AgentMessage.js';
import { StatusBar } from './StatusBar.js';

describe('UserMessage', () => {
    it('should render user content with label', () => {
        const { lastFrame } = render(<UserMessage content="你好世界" />);
        expect(lastFrame()).toContain('You');
        expect(lastFrame()).toContain('你好世界');
    });
});

describe('AgentMessage', () => {
    it('should render assistant content', () => {
        const { lastFrame } = render(<AgentMessage content="这是回复" />);
        expect(lastFrame()).toContain('这是回复');
    });

    it('should show cursor when streaming', () => {
        const { lastFrame } = render(<AgentMessage content="正在输出" streaming />);
        expect(lastFrame()).toContain('正在输出');
        expect(lastFrame()).toContain('▊');
    });

    it('should not show cursor when not streaming', () => {
        const { lastFrame } = render(<AgentMessage content="完成" />);
        expect(lastFrame()).not.toContain('▊');
    });
});

describe('StatusBar', () => {
    it('should render status and usage', () => {
        const { lastFrame } = render(
            <StatusBar status="thinking" usage={{ inputTokens: 100, outputTokens: 50 }} />,
        );
        expect(lastFrame()).toContain('thinking');
        expect(lastFrame()).toContain('150');
    });

    it('should render idle status', () => {
        const { lastFrame } = render(
            <StatusBar status="idle" usage={{ inputTokens: 0, outputTokens: 0 }} />,
        );
        expect(lastFrame()).toContain('idle');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: FAIL — 组件文件不存在

- [ ] **Step 3: 创建 ComponentContext**

```tsx
import React, { createContext, useContext } from 'react';
import type { AgentStatus } from '../adapter/types.js';
import type { ApprovalRequestEvent, PlanStep } from '@agent-tea/sdk';

// 每种组件的 Props 类型
export interface UserMessageProps {
    content: string;
}

export interface AgentMessageProps {
    content: string;
    streaming?: boolean;
}

export interface ToolCallCardProps {
    requestId: string;
    name: string;
    args: Record<string, unknown>;
    result: string;
    isError: boolean;
    durationMs: number;
    expanded?: boolean;
}

export interface ApprovalDialogProps {
    request: ApprovalRequestEvent;
    onApprove: () => void;
    onReject: (reason?: string) => void;
}

export interface PlanViewProps {
    steps: PlanStep[];
}

export interface ErrorMessageProps {
    message: string;
    fatal: boolean;
}

export interface StatusBarProps {
    status: AgentStatus;
    usage: { inputTokens: number; outputTokens: number };
}

/** 组件映射表——每种 HistoryItem 用哪个组件渲染 */
export interface ComponentMap {
    userMessage: React.ComponentType<UserMessageProps>;
    agentMessage: React.ComponentType<AgentMessageProps>;
    toolCallCard: React.ComponentType<ToolCallCardProps>;
    approvalDialog: React.ComponentType<ApprovalDialogProps>;
    planView: React.ComponentType<PlanViewProps>;
    errorMessage: React.ComponentType<ErrorMessageProps>;
    statusBar: React.ComponentType<StatusBarProps>;
}

// Context，默认值在 Provider 中设置
const ComponentContext = createContext<ComponentMap | null>(null);

export function ComponentProvider({
    components,
    children,
}: {
    components: ComponentMap;
    children: React.ReactNode;
}) {
    return <ComponentContext.Provider value={components}>{children}</ComponentContext.Provider>;
}

export function useComponents(): ComponentMap {
    const ctx = useContext(ComponentContext);
    if (!ctx) {
        throw new Error('useComponents must be used within a <ComponentProvider>');
    }
    return ctx;
}
```

- [ ] **Step 4: 实现 UserMessage**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { UserMessageProps } from './component-context.js';

export function UserMessage({ content }: UserMessageProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color="blue">
                You
            </Text>
            <Text>{content}</Text>
        </Box>
    );
}
```

- [ ] **Step 5: 实现 AgentMessage**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { AgentMessageProps } from './component-context.js';

export function AgentMessage({ content, streaming = false }: AgentMessageProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color="green">
                Assistant
            </Text>
            <Text>
                {content}
                {streaming ? '▊' : ''}
            </Text>
        </Box>
    );
}
```

- [ ] **Step 6: 实现 StatusBar**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { StatusBarProps } from './component-context.js';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    idle: { label: 'idle', color: 'gray' },
    thinking: { label: 'thinking', color: 'yellow' },
    tool_executing: { label: 'executing tool', color: 'cyan' },
    waiting_approval: { label: 'waiting approval', color: 'magenta' },
    completed: { label: 'completed', color: 'green' },
    error: { label: 'error', color: 'red' },
    aborted: { label: 'aborted', color: 'red' },
};

export function StatusBar({ status, usage }: StatusBarProps) {
    const { label, color } = STATUS_LABELS[status] ?? { label: status, color: 'white' };
    const totalTokens = usage.inputTokens + usage.outputTokens;

    return (
        <Box borderStyle="single" paddingX={1} justifyContent="space-between">
            <Text>
                Status: <Text color={color}>{label}</Text>
            </Text>
            <Text>
                tokens: <Text bold>{totalTokens}</Text>
            </Text>
        </Box>
    );
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/components/component-context.tsx packages/tui/src/components/UserMessage.tsx packages/tui/src/components/AgentMessage.tsx packages/tui/src/components/StatusBar.tsx packages/tui/src/components/components.test.tsx
git commit -m "feat(tui): add ComponentContext, UserMessage, AgentMessage, StatusBar"
```

---

## Task 6: ToolCallCard 组件

**Files:**

- Create: `packages/tui/src/components/ToolCallCard.tsx`
- Modify: `packages/tui/src/components/components.test.tsx`

- [ ] **Step 1: 在 components.test.tsx 追加 ToolCallCard 测试**

```tsx
import { ToolCallCard } from './ToolCallCard.js';

describe('ToolCallCard', () => {
    it('should render tool name and duration in collapsed state', () => {
        const { lastFrame } = render(
            <ToolCallCard
                requestId="r1"
                name="readFile"
                args={{ path: 'src/index.ts' }}
                result="file content here"
                isError={false}
                durationMs={320}
            />,
        );
        expect(lastFrame()).toContain('readFile');
        expect(lastFrame()).toContain('0.3s');
        // 折叠状态下不显示详细参数和结果
        expect(lastFrame()).not.toContain('file content here');
    });

    it('should show args and result when expanded', () => {
        const { lastFrame } = render(
            <ToolCallCard
                requestId="r1"
                name="readFile"
                args={{ path: 'src/index.ts' }}
                result="file content here"
                isError={false}
                durationMs={150}
                expanded
            />,
        );
        expect(lastFrame()).toContain('readFile');
        expect(lastFrame()).toContain('src/index.ts');
        expect(lastFrame()).toContain('file content here');
    });

    it('should highlight error state', () => {
        const { lastFrame } = render(
            <ToolCallCard
                requestId="r1"
                name="executeShell"
                args={{ command: 'rm -rf /' }}
                result="Permission denied"
                isError={true}
                durationMs={50}
                expanded
            />,
        );
        expect(lastFrame()).toContain('Permission denied');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: FAIL — ToolCallCard 不存在

- [ ] **Step 3: 实现 ToolCallCard**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCallCardProps } from './component-context.js';

export function ToolCallCard({
    name,
    args,
    result,
    isError,
    durationMs,
    expanded = false,
}: ToolCallCardProps) {
    const durationStr = (durationMs / 1000).toFixed(1) + 's';
    const icon = isError ? '✗' : '▶';
    const iconColor = isError ? 'red' : 'cyan';

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text color={iconColor}>{icon} </Text>
                <Text bold>{name}</Text>
                <Text color="gray"> {durationStr}</Text>
            </Box>
            {expanded && (
                <Box flexDirection="column" marginLeft={2}>
                    <Text color="gray">Args: {JSON.stringify(args, null, 2)}</Text>
                    <Text color={isError ? 'red' : 'white'}>Result: {result}</Text>
                </Box>
            )}
        </Box>
    );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/components/ToolCallCard.tsx packages/tui/src/components/components.test.tsx
git commit -m "feat(tui): add ToolCallCard component with expand/collapse"
```

---

## Task 7: ApprovalDialog 和 PlanView 组件

**Files:**

- Create: `packages/tui/src/components/ApprovalDialog.tsx`
- Create: `packages/tui/src/components/PlanView.tsx`
- Modify: `packages/tui/src/components/components.test.tsx`

- [ ] **Step 1: 追加测试**

```tsx
import { ApprovalDialog } from './ApprovalDialog.js';
import { PlanView } from './PlanView.js';

describe('ApprovalDialog', () => {
    it('should render tool name and args', () => {
        const { lastFrame } = render(
            <ApprovalDialog
                request={{
                    type: 'approval_request',
                    requestId: 'r1',
                    toolName: 'writeFile',
                    args: { path: '/tmp/test.txt', content: 'hello' },
                    toolDescription: 'Write a file',
                }}
                onApprove={() => {}}
                onReject={() => {}}
            />,
        );
        expect(lastFrame()).toContain('writeFile');
        expect(lastFrame()).toContain('/tmp/test.txt');
        expect(lastFrame()).toContain('[Y]');
        expect(lastFrame()).toContain('[N]');
    });
});

describe('PlanView', () => {
    it('should render steps with status icons', () => {
        const { lastFrame } = render(
            <PlanView
                steps={[
                    {
                        index: 0,
                        description: 'Read files',
                        status: 'completed',
                        result: { summary: 'done', toolCallCount: 2 },
                    },
                    { index: 1, description: 'Write code', status: 'executing' },
                    { index: 2, description: 'Run tests', status: 'pending' },
                ]}
            />,
        );
        expect(lastFrame()).toContain('Read files');
        expect(lastFrame()).toContain('Write code');
        expect(lastFrame()).toContain('Run tests');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 ApprovalDialog**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ApprovalDialogProps } from './component-context.js';

export function ApprovalDialog({ request, onApprove, onReject }: ApprovalDialogProps) {
    return (
        <Box
            flexDirection="column"
            borderStyle="double"
            borderColor="yellow"
            paddingX={1}
            marginY={1}
        >
            <Text bold color="yellow">
                Approval Required
            </Text>
            <Box marginTop={1} flexDirection="column">
                <Text>
                    Tool: <Text bold>{request.toolName}</Text>
                </Text>
                {request.toolDescription && <Text color="gray">{request.toolDescription}</Text>}
                <Text color="gray">Args: {JSON.stringify(request.args, null, 2)}</Text>
            </Box>
            <Box marginTop={1}>
                <Text>
                    <Text color="green">[Y]</Text> Approve {'  '}
                    <Text color="red">[N]</Text> Reject
                </Text>
            </Box>
        </Box>
    );
}
```

- [ ] **Step 4: 实现 PlanView**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { PlanViewProps } from './component-context.js';
import type { PlanStep } from '@agent-tea/sdk';

const STATUS_ICON: Record<PlanStep['status'], string> = {
    pending: '○',
    executing: '▶',
    completed: '✓',
    failed: '✗',
    skipped: '–',
};

const STATUS_COLOR: Record<PlanStep['status'], string> = {
    pending: 'gray',
    executing: 'yellow',
    completed: 'green',
    failed: 'red',
    skipped: 'gray',
};

export function PlanView({ steps }: PlanViewProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color="magenta">
                Plan
            </Text>
            {steps.map((step) => (
                <Box key={step.index}>
                    <Text color={STATUS_COLOR[step.status]}>{STATUS_ICON[step.status]} </Text>
                    <Text color={step.status === 'pending' ? 'gray' : 'white'}>
                        {step.index + 1}. {step.description}
                    </Text>
                </Box>
            ))}
        </Box>
    );
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/components/ApprovalDialog.tsx packages/tui/src/components/PlanView.tsx packages/tui/src/components/components.test.tsx
git commit -m "feat(tui): add ApprovalDialog and PlanView components"
```

---

## Task 8: History 组件

**Files:**

- Create: `packages/tui/src/components/History.tsx`
- Create: `packages/tui/src/components/ErrorMessage.tsx`
- Create: `packages/tui/src/components/index.ts`
- Modify: `packages/tui/src/components/components.test.tsx`

- [ ] **Step 1: 追加 History 测试**

```tsx
import { History } from './History.js';
import { ComponentProvider } from './component-context.js';
import { UserMessage } from './UserMessage.js';
import { AgentMessage } from './AgentMessage.js';
import { ToolCallCard } from './ToolCallCard.js';
import { ApprovalDialog } from './ApprovalDialog.js';
import { PlanView } from './PlanView.js';
import { ErrorMessage } from './ErrorMessage.js';
import { StatusBar } from './StatusBar.js';
import type { HistoryItem } from '../adapter/types.js';
import type { ComponentMap } from './component-context.js';

const defaultComponents: ComponentMap = {
    userMessage: UserMessage,
    agentMessage: AgentMessage,
    toolCallCard: ToolCallCard,
    approvalDialog: ApprovalDialog,
    planView: PlanView,
    errorMessage: ErrorMessage,
    statusBar: StatusBar,
};

function renderWithComponents(ui: React.ReactElement) {
    return render(<ComponentProvider components={defaultComponents}>{ui}</ComponentProvider>);
}

describe('History', () => {
    it('should render message items', () => {
        const items: HistoryItem[] = [
            { type: 'message', role: 'user', content: '你好' },
            { type: 'message', role: 'assistant', content: '你好！有什么可以帮你？' },
        ];
        const { lastFrame } = renderWithComponents(<History items={items} />);
        expect(lastFrame()).toContain('你好');
        expect(lastFrame()).toContain('你好！有什么可以帮你？');
    });

    it('should render tool call items', () => {
        const items: HistoryItem[] = [
            {
                type: 'tool_call',
                requestId: 'r1',
                name: 'readFile',
                args: { path: 'a.ts' },
                result: 'content',
                isError: false,
                durationMs: 200,
            },
        ];
        const { lastFrame } = renderWithComponents(<History items={items} />);
        expect(lastFrame()).toContain('readFile');
    });

    it('should render streaming text', () => {
        const items: HistoryItem[] = [];
        const { lastFrame } = renderWithComponents(
            <History items={items} streaming="正在生成..." />,
        );
        expect(lastFrame()).toContain('正在生成...');
        expect(lastFrame()).toContain('▊');
    });

    it('should render error items', () => {
        const items: HistoryItem[] = [{ type: 'error', message: 'API rate limit', fatal: true }];
        const { lastFrame } = renderWithComponents(<History items={items} />);
        expect(lastFrame()).toContain('API rate limit');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 ErrorMessage**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ErrorMessageProps } from './component-context.js';

export function ErrorMessage({ message, fatal }: ErrorMessageProps) {
    return (
        <Box marginBottom={1}>
            <Text color="red">
                {fatal ? '✗ Fatal: ' : '⚠ '}
                {message}
            </Text>
        </Box>
    );
}
```

- [ ] **Step 4: 实现 History**

```tsx
import React from 'react';
import { Box } from 'ink';
import { useComponents } from './component-context.js';
import type { HistoryItem } from '../adapter/types.js';

export interface HistoryProps {
    items: HistoryItem[];
    streaming?: string | null;
}

export function History({ items, streaming }: HistoryProps) {
    const components = useComponents();

    return (
        <Box flexDirection="column">
            {items.map((item, i) => {
                switch (item.type) {
                    case 'message':
                        return item.role === 'user' ? (
                            <components.userMessage key={i} content={item.content} />
                        ) : (
                            <components.agentMessage key={i} content={item.content} />
                        );
                    case 'tool_call':
                        return (
                            <components.toolCallCard
                                key={i}
                                requestId={item.requestId}
                                name={item.name}
                                args={item.args}
                                result={item.result}
                                isError={item.isError}
                                durationMs={item.durationMs}
                            />
                        );
                    case 'plan':
                        return <components.planView key={i} steps={item.steps} />;
                    case 'error':
                        return (
                            <components.errorMessage
                                key={i}
                                message={item.message}
                                fatal={item.fatal}
                            />
                        );
                }
            })}
            {streaming && <components.agentMessage content={streaming} streaming />}
        </Box>
    );
}
```

- [ ] **Step 5: 创建 components/index.ts**

```typescript
export { ComponentProvider, useComponents } from './component-context.js';
export type {
    ComponentMap,
    UserMessageProps,
    AgentMessageProps,
    ToolCallCardProps,
    ApprovalDialogProps,
    PlanViewProps,
    ErrorMessageProps,
    StatusBarProps,
} from './component-context.js';
export { UserMessage } from './UserMessage.js';
export { AgentMessage } from './AgentMessage.js';
export { ToolCallCard } from './ToolCallCard.js';
export { ApprovalDialog } from './ApprovalDialog.js';
export { PlanView } from './PlanView.js';
export { ErrorMessage } from './ErrorMessage.js';
export { StatusBar } from './StatusBar.js';
export { History, type HistoryProps } from './History.js';
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/components/components.test.tsx`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/components/
git commit -m "feat(tui): add History and ErrorMessage components with ComponentContext"
```

---

## Task 9: Composer 输入框

**Files:**

- Create: `packages/tui/src/runner/Composer.tsx`

- [ ] **Step 1: 实现 Composer**

```tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface ComposerProps {
    onSubmit: (query: string) => void;
    disabled?: boolean;
    placeholder?: string;
}

export function Composer({
    onSubmit,
    disabled = false,
    placeholder = '输入你的问题...',
}: ComposerProps) {
    const [value, setValue] = useState('');

    const handleSubmit = (text: string) => {
        const trimmed = text.trim();
        if (trimmed && !disabled) {
            onSubmit(trimmed);
            setValue('');
        }
    };

    return (
        <Box borderStyle="single" paddingX={1}>
            <Text color={disabled ? 'gray' : 'white'}>&gt; </Text>
            <TextInput
                value={value}
                onChange={setValue}
                onSubmit={handleSubmit}
                placeholder={disabled ? '等待响应...' : placeholder}
            />
        </Box>
    );
}
```

- [ ] **Step 2: 验证类型检查**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm --filter @agent-tea/tui typecheck`
Expected: 成功

- [ ] **Step 3: Commit**

```bash
git add packages/tui/src/runner/Composer.tsx
git commit -m "feat(tui): add Composer input component"
```

---

## Task 10: DefaultLayout 和 AgentTUI Runner

**Files:**

- Create: `packages/tui/src/runner/DefaultLayout.tsx`
- Create: `packages/tui/src/runner/AgentTUI.tsx`
- Create: `packages/tui/src/runner/index.ts`
- Create: `packages/tui/src/runner/agent-tui.test.tsx`

- [ ] **Step 1: 写 AgentTUI 集成测试**

```tsx
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { AgentTUI } from './AgentTUI.js';
import { mockAgentRun } from '../test-utils.js';
import type { AgentEvent } from '@agent-tea/sdk';

describe('AgentTUI', () => {
    it('should render initial idle state', () => {
        const agent = mockAgentRun([]);
        const { lastFrame } = render(<AgentTUI agent={agent as any} />);
        expect(lastFrame()).toContain('idle');
    });

    it('should render agent response after initialQuery', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'message', role: 'assistant', content: '你好！' },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const { lastFrame } = render(<AgentTUI agent={agent as any} initialQuery="你好" />);

        // 等待事件处理完成
        await new Promise((r) => setTimeout(r, 100));
        const frame = lastFrame();
        expect(frame).toContain('你好！');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/runner/agent-tui.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 DefaultLayout**

```tsx
import React from 'react';
import { Box } from 'ink';

export interface LayoutProps {
    history: React.ReactNode;
    statusBar: React.ReactNode;
    composer: React.ReactNode;
    approval: React.ReactNode | null;
}

export function DefaultLayout({ history, statusBar, composer, approval }: LayoutProps) {
    return (
        <Box flexDirection="column" height="100%">
            {statusBar}
            <Box flexDirection="column" flexGrow={1}>
                {history}
            </Box>
            {approval}
            {composer}
        </Box>
    );
}
```

- [ ] **Step 4: 实现 AgentTUI**

```tsx
import React, { useCallback } from 'react';
import { useInput } from 'ink';
import type { BaseAgent, ApprovalDecision, ApprovalRequestEvent } from '@agent-tea/sdk';
import { useAgentEvents } from '../hooks/use-agent-events.js';
import { useApproval } from '../hooks/use-approval.js';
import { ComponentProvider, type ComponentMap } from '../components/component-context.js';
import { UserMessage } from '../components/UserMessage.js';
import { AgentMessage } from '../components/AgentMessage.js';
import { ToolCallCard } from '../components/ToolCallCard.js';
import { ApprovalDialog } from '../components/ApprovalDialog.js';
import { PlanView } from '../components/PlanView.js';
import { ErrorMessage } from '../components/ErrorMessage.js';
import { StatusBar } from '../components/StatusBar.js';
import { History } from '../components/History.js';
import { Composer } from './Composer.js';
import { DefaultLayout, type LayoutProps } from './DefaultLayout.js';

const DEFAULT_COMPONENTS: ComponentMap = {
    userMessage: UserMessage,
    agentMessage: AgentMessage,
    toolCallCard: ToolCallCard,
    approvalDialog: ApprovalDialog,
    planView: PlanView,
    errorMessage: ErrorMessage,
    statusBar: StatusBar,
};

export interface AgentTUIProps {
    agent: BaseAgent;
    initialQuery?: string;
    components?: Partial<ComponentMap>;
    layout?: React.ComponentType<LayoutProps>;
    onApproval?: (req: ApprovalRequestEvent) => Promise<ApprovalDecision>;
    onComplete?: (snapshot: import('../adapter/types.js').AgentSnapshot) => void;
}

export function AgentTUI({
    agent,
    initialQuery,
    components: customComponents,
    layout: Layout = DefaultLayout,
    onApproval,
    onComplete,
}: AgentTUIProps) {
    const mergedComponents: ComponentMap = { ...DEFAULT_COMPONENTS, ...customComponents };
    const { snapshot, run, abort } = useAgentEvents(agent, initialQuery ?? null);
    const { approve, reject } = useApproval(agent);

    const isRunning = snapshot.status === 'thinking' || snapshot.status === 'tool_executing';

    const handleSubmit = useCallback(
        (query: string) => {
            run(query);
        },
        [run],
    );

    // Ctrl+C 优雅中止 + 审批快捷键
    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            abort();
        }
        if (snapshot.pendingApproval && !onApproval) {
            // 仅在没有自定义审批处理时使用内置快捷键
            if (input === 'y' || input === 'Y') {
                approve(snapshot.pendingApproval.requestId);
            }
            if (input === 'n' || input === 'N') {
                reject(snapshot.pendingApproval.requestId);
            }
        }
    });

    // 自定义审批处理
    React.useEffect(() => {
        if (snapshot.pendingApproval && onApproval) {
            onApproval(snapshot.pendingApproval).then((decision) => {
                agent.resolveApproval(snapshot.pendingApproval!.requestId, decision);
            });
        }
    }, [snapshot.pendingApproval]);

    // 完成回调
    React.useEffect(() => {
        if (snapshot.status === 'completed' && onComplete) {
            onComplete(snapshot);
        }
    }, [snapshot.status]);

    const approvalElement = snapshot.pendingApproval ? (
        <mergedComponents.approvalDialog
            request={snapshot.pendingApproval}
            onApprove={() => approve(snapshot.pendingApproval!.requestId)}
            onReject={() => reject(snapshot.pendingApproval!.requestId)}
        />
    ) : null;

    return (
        <ComponentProvider components={mergedComponents}>
            <Layout
                statusBar={
                    <mergedComponents.statusBar status={snapshot.status} usage={snapshot.usage} />
                }
                history={<History items={snapshot.history} streaming={snapshot.streaming} />}
                approval={approvalElement}
                composer={<Composer onSubmit={handleSubmit} disabled={isRunning} />}
            />
        </ComponentProvider>
    );
}
```

- [ ] **Step 5: 创建 runner/index.ts**

```typescript
export { AgentTUI, type AgentTUIProps } from './AgentTUI.js';
export { DefaultLayout, type LayoutProps } from './DefaultLayout.js';
export { Composer, type ComposerProps } from './Composer.js';
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/src/runner/agent-tui.test.tsx`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/tui/src/runner/
git commit -m "feat(tui): add AgentTUI runner with DefaultLayout and keyboard shortcuts"
```

---

## Task 11: 统一导出

**Files:**

- Modify: `packages/tui/src/index.ts`

- [ ] **Step 1: 更新 src/index.ts**

```typescript
// @agent-tea/tui — Terminal UI framework for agent-tea

// Re-export SDK（开发者只需 import from '@agent-tea/tui'）
export * from '@agent-tea/sdk';

// Adapter 层
export { createEventCollector, type EventCollector } from './adapter/index.js';
export {
    type AgentSnapshot,
    type AgentStatus,
    type HistoryItem,
    type MessageItem,
    type ToolCallItem,
    type PlanItem,
    type ErrorItem,
    createInitialSnapshot,
} from './adapter/index.js';

// Hooks 层
export { useAgentEvents } from './hooks/index.js';
export { useApproval } from './hooks/index.js';

// Components 层
export { ComponentProvider, useComponents } from './components/index.js';
export type {
    ComponentMap,
    UserMessageProps,
    AgentMessageProps,
    ToolCallCardProps,
    ApprovalDialogProps,
    PlanViewProps,
    ErrorMessageProps,
    StatusBarProps,
} from './components/index.js';
export {
    UserMessage,
    AgentMessage,
    ToolCallCard,
    ApprovalDialog,
    PlanView,
    ErrorMessage,
    StatusBar,
    History,
} from './components/index.js';

// Runner 层
export { AgentTUI, type AgentTUIProps } from './runner/index.js';
export { DefaultLayout, type LayoutProps } from './runner/index.js';
export { Composer, type ComposerProps } from './runner/index.js';
```

- [ ] **Step 2: 验证构建**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm --filter @agent-tea/tui build`
Expected: 成功生成 `dist/index.js` 和 `dist/index.d.ts`

- [ ] **Step 3: 运行全部测试**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/index.ts
git commit -m "feat(tui): wire up package exports"
```

---

## Task 12: SDK Examples（17-19）

**Files:**

- Create: `examples/17-event-collector.ts`
- Create: `examples/18-batch-run.ts`
- Create: `examples/19-sdk-subagent-collector.ts`
- Modify: `package.json`（根）

- [ ] **Step 1: 创建 example 17 — EventCollector**

```typescript
import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { createEventCollector } from '../packages/tui/src/adapter/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const weatherTool = tool({
    name: 'getWeather',
    description: '获取指定城市的天气信息',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `${city}：晴，25°C`,
});

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [weatherTool],
    systemPrompt: '你是一个天气助手。',
});

const query = process.argv[2] || '北京今天天气怎么样？';
console.log(`\n查询: ${query}\n`);

const collector = createEventCollector(agent, query);

collector.on('snapshot', (snapshot) => {
    // 每次状态变化时输出一行状态摘要
    const toolCalls = snapshot.history.filter((h) => h.type === 'tool_call').length;
    process.stdout.write(
        `\r[${snapshot.status}] history: ${snapshot.history.length} items, tools: ${toolCalls}, tokens: ${snapshot.usage.inputTokens + snapshot.usage.outputTokens}`,
    );
});

const result = await collector.start();
console.log('\n\n--- 最终结果 ---');
const lastMessage = result.history
    .filter((h) => h.type === 'message' && h.role === 'assistant')
    .at(-1);
if (lastMessage?.type === 'message') {
    console.log(lastMessage.content);
}
console.log(`\nToken 用量: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
```

- [ ] **Step 2: 创建 example 18 — 批量运行**

```typescript
import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { createEventCollector } from '../packages/tui/src/adapter/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const calcTool = tool({
    name: 'calculate',
    description: '计算数学表达式',
    parameters: z.object({ expression: z.string() }),
    execute: async ({ expression }) => {
        try {
            return String(Function(`"use strict"; return (${expression})`)());
        } catch {
            return '计算错误';
        }
    },
});

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [calcTool],
    systemPrompt: '你是一个数学助手，用 calculate 工具计算后回答。',
});

const queries = ['123 * 456 等于多少？', '圆周率的前 10 位是什么？', '2 的 10 次方是多少？'];

console.log(`\n批量运行 ${queries.length} 个查询\n`);

const results = await Promise.all(
    queries.map(async (query) => {
        const collector = createEventCollector(agent, query);
        const snapshot = await collector.start();
        const answer = snapshot.history
            .filter((h) => h.type === 'message' && h.role === 'assistant')
            .at(-1);
        return {
            query,
            answer: answer?.type === 'message' ? answer.content : '(无回复)',
            tokens: snapshot.usage.inputTokens + snapshot.usage.outputTokens,
        };
    }),
);

for (const r of results) {
    console.log(`Q: ${r.query}`);
    console.log(`A: ${r.answer}`);
    console.log(`   (${r.tokens} tokens)\n`);
}
```

- [ ] **Step 3: 创建 example 19 — SubAgent + Collector**

```typescript
import { Agent, tool, subAgent, z } from '../packages/sdk/src/index.js';
import { createEventCollector } from '../packages/tui/src/adapter/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

// 研究子 Agent
const researchAgent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    systemPrompt: '你是一个研究助手，简洁回答问题。',
});

const researchTool = subAgent({
    agent: researchAgent,
    name: 'research',
    description: '委派研究任务给专门的研究 Agent',
});

// 主 Agent
const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [researchTool],
    systemPrompt: '你是项目经理，遇到需要研究的问题就委派给 research 工具。',
});

const query = process.argv[2] || '帮我研究一下 TypeScript 5.0 的新特性';
console.log(`\n查询: ${query}\n`);

const collector = createEventCollector(agent, query);

collector.on('snapshot', (snapshot) => {
    const lastItem = snapshot.history.at(-1);
    if (lastItem?.type === 'tool_call' && lastItem.name === 'research') {
        console.log(`[SubAgent] research 完成 (${lastItem.durationMs}ms)`);
    }
});

const result = await collector.start();
console.log('\n--- 最终结果 ---');
const lastMessage = result.history
    .filter((h) => h.type === 'message' && h.role === 'assistant')
    .at(-1);
if (lastMessage?.type === 'message') {
    console.log(lastMessage.content);
}
```

- [ ] **Step 4: 在根 package.json 添加 example 脚本**

在 `scripts` 中追加：

```json
"example:17": "node --env-file=.env --import tsx examples/17-event-collector.ts",
"example:18": "node --env-file=.env --import tsx examples/18-batch-run.ts",
"example:19": "node --env-file=.env --import tsx examples/19-sdk-subagent-collector.ts"
```

- [ ] **Step 5: Commit**

```bash
git add examples/17-event-collector.ts examples/18-batch-run.ts examples/19-sdk-subagent-collector.ts package.json
git commit -m "feat(examples): add SDK examples 17-19 using EventCollector"
```

---

## Task 13: TUI Examples（20-23）

**Files:**

- Create: `examples/20-tui-minimal.tsx`
- Create: `examples/21-tui-custom-components.tsx`
- Create: `examples/22-tui-custom-layout.tsx`
- Create: `examples/23-tui-plan-execute.tsx`
- Modify: `package.json`（根）

- [ ] **Step 1: 创建 example 20 — 最小 TUI**

```tsx
import React from 'react';
import { render } from 'ink';
import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { AgentTUI } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const weatherTool = tool({
    name: 'getWeather',
    description: '获取指定城市的天气信息',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `${city}：晴，25°C，湿度 60%`,
});

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [weatherTool],
    systemPrompt: '你是一个天气助手。',
});

render(<AgentTUI agent={agent} />);
```

- [ ] **Step 2: 创建 example 21 — 自定义组件**

```tsx
import React from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { AgentTUI, type ToolCallCardProps } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

// 自定义 ToolCallCard：始终展开，带彩色边框
function MyToolCard({ name, args, result, isError, durationMs }: ToolCallCardProps) {
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={isError ? 'red' : 'green'}
            paddingX={1}
            marginBottom={1}
        >
            <Text bold>
                🔧 {name} <Text color="gray">({(durationMs / 1000).toFixed(1)}s)</Text>
            </Text>
            <Text color="gray">输入: {JSON.stringify(args)}</Text>
            <Text color={isError ? 'red' : 'white'}>输出: {result}</Text>
        </Box>
    );
}

const weatherTool = tool({
    name: 'getWeather',
    description: '获取天气',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `${city}：多云，22°C`,
});

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [weatherTool],
    systemPrompt: '你是天气助手。',
});

render(
    <AgentTUI
        agent={agent}
        components={{ toolCallCard: MyToolCard }}
        initialQuery="北京和上海的天气分别怎么样？"
    />,
);
```

- [ ] **Step 3: 创建 example 22 — 自定义布局（双面板）**

```tsx
import React from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { Agent, tool, z, readFile, listDirectory } from '../packages/sdk/src/index.js';
import { AgentTUI, type LayoutProps } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

// 双面板布局：左边聊天，右边状态
function DualPanelLayout({ history, statusBar, composer, approval }: LayoutProps) {
    return (
        <Box flexDirection="column" height="100%">
            {statusBar}
            <Box flexGrow={1}>
                <Box flexDirection="column" width="70%">
                    {history}
                </Box>
                <Box
                    flexDirection="column"
                    width="30%"
                    borderStyle="single"
                    borderColor="gray"
                    paddingX={1}
                >
                    <Text bold color="cyan">
                        工具日志
                    </Text>
                    <Text color="gray">（工具调用记录显示在左侧历史中）</Text>
                </Box>
            </Box>
            {approval}
            {composer}
        </Box>
    );
}

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [readFile, listDirectory],
    systemPrompt: '你是一个代码分析助手。',
});

render(<AgentTUI agent={agent} layout={DualPanelLayout} initialQuery="分析当前目录的项目结构" />);
```

- [ ] **Step 4: 创建 example 23 — PlanAndExecute TUI**

```tsx
import React from 'react';
import { render } from 'ink';
import {
    PlanAndExecuteAgent,
    tool,
    z,
    readFile,
    listDirectory,
    grep,
} from '../packages/sdk/src/index.js';
import { AgentTUI } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const agent = new PlanAndExecuteAgent({
    provider,
    model: 'gpt-4o',
    tools: [readFile, listDirectory, grep],
    systemPrompt: '你是一个代码分析专家。先制定计划，再逐步执行。',
    // 计划阶段只允许 readonly 工具
    onPlanCreated: async (plan) => {
        // TUI 会自动显示 plan_created 事件，用户在 TUI 中审批
        return { approved: true };
    },
});

render(<AgentTUI agent={agent} initialQuery={process.argv[2] || '分析这个项目的架构设计'} />);
```

- [ ] **Step 5: 在根 package.json 添加 TUI example 脚本**

```json
"example:20": "node --env-file=.env --import tsx examples/20-tui-minimal.tsx",
"example:21": "node --env-file=.env --import tsx examples/21-tui-custom-components.tsx",
"example:22": "node --env-file=.env --import tsx examples/22-tui-custom-layout.tsx",
"example:23": "node --env-file=.env --import tsx examples/23-tui-plan-execute.tsx"
```

- [ ] **Step 6: Commit**

```bash
git add examples/20-tui-minimal.tsx examples/21-tui-custom-components.tsx examples/22-tui-custom-layout.tsx examples/23-tui-plan-execute.tsx package.json
git commit -m "feat(examples): add TUI examples 20-23"
```

---

## Task 14: 全量验证

**Files:** 无新建/修改

- [ ] **Step 1: 运行全部 TUI 包测试**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/tui/`
Expected: 全部 PASS

- [ ] **Step 2: 类型检查全部包**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm typecheck`
Expected: 全部 PASS

- [ ] **Step 3: 构建全部包**

Run: `cd /Users/ssh/code-ai-agent/agent-tea && pnpm build`
Expected: 全部成功，`packages/tui/dist/` 生成 `index.js` + `index.d.ts`

- [ ] **Step 4: 确认 TUI 包 dist 内容**

Run: `ls -la /Users/ssh/code-ai-agent/agent-tea/packages/tui/dist/`
Expected: 包含 `index.js`、`index.d.ts`、`index.js.map`
