# Agent 框架问题修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复用户体验测试中发现的 5 个关键问题：SubAgent 状态机复用崩溃、多轮对话缺失、Plan 格式不像计划、输出乱码、整体流程不顺。

**Architecture:** 核心修复集中在 3 层：Core 层修复状态机重置和 Plan 解析；SDK 层修复 SubAgent 复用模式；TUI 层增加多轮对话消息累积。每个修复独立可测试。

**Tech Stack:** TypeScript, Vitest, Zod, Ink (React for terminal)

---

## 文件结构

| 修改文件                                                        | 职责                                               |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `packages/core/src/agent/state-machine.ts`                      | 添加 `reset()` 方法                                |
| `packages/core/src/agent/loop-detection.ts`                     | 添加 `LoopDetector.reset()` 方法                   |
| `packages/core/src/agent/base-agent.ts`                         | 暴露 `resetForReuse()` 方法，重置状态机+循环检测器 |
| `packages/core/src/agent/react-agent.test.ts`                   | 添加多次 `run()` 的测试                            |
| `packages/sdk/src/sub-agent.ts`                                 | 每次调用前 reset agent，或改为每次新建 agent       |
| `packages/sdk/src/sub-agent.test.ts`                            | 新建：SubAgent 多次调用测试                        |
| `packages/core/src/agent/plan-and-execute-agent.ts`             | 改进 `parsePlan()` + 加强系统提示中的计划格式指令  |
| `packages/core/src/agent/plan-and-execute-agent.test.ts`        | 添加计划解析的边界测试                             |
| `packages/tui/src/adapter/event-collector.ts`                   | 支持传入 `Message[]` 而非仅 `string`               |
| `packages/tui/src/hooks/use-agent-events.ts`                    | 多轮对话：累积 history 传给 agent                  |
| `packages/tui/src/runner/AgentTUI.tsx`                          | 适配多轮模式                                       |
| `packages/core/src/tools/builtin/execute-shell.ts`              | 修复 UTF-8 安全截断                                |
| `packages/core/src/tools/builtin/web-fetch.ts`                  | 修复 UTF-8 安全截断                                |
| `packages/core/src/context/processors/tool-output-truncator.ts` | 修复 UTF-8 安全截断                                |

---

### Task 1: 修复 SubAgent 状态机复用崩溃

**问题**：`subAgent()` 在创建时只实例化一个 `ReActAgent`，多次调用时状态机卡在 `completed` 无法回到 `idle`。

**Files:**

- Modify: `packages/core/src/agent/state-machine.ts`
- Modify: `packages/core/src/agent/loop-detection.ts`
- Modify: `packages/core/src/agent/base-agent.ts`
- Test: `packages/core/src/agent/react-agent.test.ts`

- [ ] **Step 1: 给 AgentStateMachine 添加 reset() 方法 — 写测试**

在 `packages/core/src/agent/react-agent.test.ts` 末尾添加：

```typescript
describe('Agent reuse (multiple run() calls)', () => {
    it('should support calling run() multiple times on the same agent instance', async () => {
        const responses = [
            // 第一次 run：直接返回文本
            [{ type: 'text' as const, text: 'First response' }, { type: 'finish' as const }],
            // 第二次 run：也直接返回文本
            [{ type: 'text' as const, text: 'Second response' }, { type: 'finish' as const }],
        ];

        const agent = new ReActAgent({
            provider: mockProvider(responses),
            model: 'test',
        });

        // 第一次运行
        const events1: AgentEvent[] = [];
        for await (const event of agent.run('Hello')) {
            events1.push(event);
        }
        expect(events1.some((e) => e.type === 'message' && e.content === 'First response')).toBe(
            true,
        );
        expect(events1.some((e) => e.type === 'agent_end' && e.reason === 'complete')).toBe(true);

        // 第二次运行 — 之前会抛 "Invalid state transition: completed → reacting"
        const events2: AgentEvent[] = [];
        for await (const event of agent.run('Hello again')) {
            events2.push(event);
        }
        expect(events2.some((e) => e.type === 'message' && e.content === 'Second response')).toBe(
            true,
        );
        expect(events2.some((e) => e.type === 'agent_end' && e.reason === 'complete')).toBe(true);
    });

    it('should support reuse with tool calls', async () => {
        const responses = [
            // 第一次 run：调用工具后返回
            [
                { type: 'tool_call' as const, id: 'tc1', name: 'echo', args: { text: 'a' } },
                { type: 'finish' as const },
            ],
            [{ type: 'text' as const, text: 'Done first' }, { type: 'finish' as const }],
            // 第二次 run：调用工具后返回
            [
                { type: 'tool_call' as const, id: 'tc2', name: 'echo', args: { text: 'b' } },
                { type: 'finish' as const },
            ],
            [{ type: 'text' as const, text: 'Done second' }, { type: 'finish' as const }],
        ];

        const echoTool = tool(
            { name: 'echo', description: 'Echo', parameters: z.object({ text: z.string() }) },
            async ({ text }) => text,
        );

        const agent = new ReActAgent({
            provider: mockProvider(responses),
            model: 'test',
            tools: [echoTool],
        });

        // 第一次运行
        for await (const _event of agent.run('First')) {
            /* consume */
        }

        // 第二次运行
        const events: AgentEvent[] = [];
        for await (const event of agent.run('Second')) {
            events.push(event);
        }
        expect(events.some((e) => e.type === 'message' && e.content === 'Done second')).toBe(true);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/agent/react-agent.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — "Invalid state transition: completed → reacting"

- [ ] **Step 3: 实现 AgentStateMachine.reset()**

在 `packages/core/src/agent/state-machine.ts` 的 `onTransition` 方法后添加：

```typescript
/** 重置状态机到初始 idle 状态（用于复用同一 Agent 实例的场景） */
reset(): void {
    this.state = 'idle';
}
```

- [ ] **Step 4: 实现 LoopDetector.reset()**

在 `packages/core/src/agent/loop-detection.ts` 的 `LoopDetector` 类末尾（`escalate` 方法后）添加：

```typescript
/** 重置所有检测状态（用于复用同一 Agent 实例的场景） */
reset(): void {
    this.toolTracker = new ToolCallTracker();
    this.contentTracker = new ContentTracker();
    this.warningCount = 0;
}
```

- [ ] **Step 5: 在 BaseAgent.run() 开头重置状态**

在 `packages/core/src/agent/base-agent.ts` 的 `run()` 方法中，`yield { type: 'agent_start' ... }` 之前添加：

```typescript
// 支持同一 Agent 实例多次调用：重置状态机和循环检测器
this.stateMachine.reset();
this.loopDetector.reset();
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm vitest run packages/core/src/agent/react-agent.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/agent/state-machine.ts packages/core/src/agent/loop-detection.ts packages/core/src/agent/base-agent.ts packages/core/src/agent/react-agent.test.ts
git commit -m "fix: support Agent instance reuse by resetting state machine and loop detector between runs"
```

---

### Task 2: 修复 SubAgent 多次调用测试

**问题**：SubAgent 封装了 ReActAgent 作为工具，Task 1 修复了底层，但需要验证 SubAgent 场景也工作正常。

**Files:**

- Create: `packages/sdk/src/sub-agent.test.ts`

- [ ] **Step 1: 创建 SubAgent 集成测试**

```typescript
import { describe, it, expect } from 'vitest';
import { subAgent } from './sub-agent.js';
import { ReActAgent } from '@agent-tea/core';
import { tool, z } from '@agent-tea/core';
import type { ChatStreamEvent, LLMProvider, ChatSession } from '@agent-tea/core';

function mockProvider(responseSequence: ChatStreamEvent[][]): LLMProvider {
    let callIndex = 0;
    return {
        chat() {
            return {
                async *sendMessage() {
                    const events = responseSequence[callIndex++] ?? [];
                    for (const event of events) {
                        yield event;
                    }
                },
            } as ChatSession;
        },
    } as LLMProvider;
}

describe('subAgent', () => {
    it('should be callable multiple times by parent agent', async () => {
        // SubAgent 的 mock：每次调用直接返回文本
        const subResponses: ChatStreamEvent[][] = [
            [{ type: 'text', text: 'Sub result 1' }, { type: 'finish' }],
            [{ type: 'text', text: 'Sub result 2' }, { type: 'finish' }],
        ];

        const subProvider = mockProvider(subResponses);

        const sub = subAgent({
            name: 'helper',
            description: 'A helper agent',
            provider: subProvider,
            model: 'test',
        });

        // 父 Agent 调用 SubAgent 两次
        const parentResponses: ChatStreamEvent[][] = [
            // 第一次：调用 helper
            [
                { type: 'tool_call', id: 'tc1', name: 'helper', args: { task: 'Task A' } },
                { type: 'finish' },
            ],
            // 收到结果后再调用 helper
            [
                { type: 'tool_call', id: 'tc2', name: 'helper', args: { task: 'Task B' } },
                { type: 'finish' },
            ],
            // 最终返回
            [{ type: 'text', text: 'All done' }, { type: 'finish' }],
        ];

        const parentAgent = new ReActAgent({
            provider: mockProvider(parentResponses),
            model: 'test',
            tools: [sub],
        });

        const events = [];
        for await (const event of parentAgent.run('Do two tasks')) {
            events.push(event);
        }

        // 验证两次 SubAgent 调用都成功
        const toolResponses = events.filter((e) => e.type === 'tool_response');
        expect(toolResponses).toHaveLength(2);
        expect(toolResponses[0].content).toContain('Sub result 1');
        expect(toolResponses[1].content).toContain('Sub result 2');

        // 验证最终完成
        expect(events.some((e) => e.type === 'agent_end' && e.reason === 'complete')).toBe(true);
    });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm vitest run packages/sdk/src/sub-agent.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS（依赖 Task 1 的修复）

- [ ] **Step 3: 提交**

```bash
git add packages/sdk/src/sub-agent.test.ts
git commit -m "test: add SubAgent multi-invocation test to verify agent reuse"
```

---

### Task 3: 多轮对话支持

**问题**：每次 `run()` 都是独立会话，TUI 虽然有输入框但每次提交都丢失上下文。

**方案**：

1. `EventCollector` 支持 `Message[]` 输入
2. `useAgentEvents` 累积消息历史，后续提交带上完整历史
3. `AgentTUI` 在新的 run 之前保留旧 history

**Files:**

- Modify: `packages/tui/src/adapter/event-collector.ts`
- Modify: `packages/tui/src/hooks/use-agent-events.ts`
- Modify: `packages/tui/src/runner/AgentTUI.tsx`

- [ ] **Step 1: EventCollector 支持 Message[] 输入**

修改 `packages/tui/src/adapter/event-collector.ts`：

将 `createEventCollector` 签名从：

```typescript
export function createEventCollector(
    agent: Pick<BaseAgent, 'run'>,
    query: string,
): EventCollector {
```

改为：

```typescript
import type { Message } from '@agent-tea/sdk';

export function createEventCollector(
    agent: Pick<BaseAgent, 'run'>,
    input: string | Message[],
): EventCollector {
```

然后在 `start()` 方法中：

```typescript
async start(): Promise<AgentSnapshot> {
    for await (const event of agent.run(input, abortController.signal)) {
        handleEvent(event);
    }
    // ...
```

- [ ] **Step 2: useAgentEvents 支持多轮消息累积**

修改 `packages/tui/src/hooks/use-agent-events.ts`：

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';
import type { BaseAgent, Message } from '@agent-tea/sdk';
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
    // 累积所有对话消息，用于多轮上下文
    const messagesRef = useRef<Message[]>([]);

    const run = useCallback(
        (query: string) => {
            collectorRef.current?.abort();

            // 将用户新消息追加到历史
            messagesRef.current = [
                ...messagesRef.current,
                { role: 'user' as const, content: query },
            ];

            // 传入完整消息历史
            const collector = createEventCollector(agent, messagesRef.current);
            collectorRef.current = collector;

            collector.on('snapshot', (s) => setSnapshot(s));

            // Agent 完成后，从 snapshot 提取 assistant 回复追加到消息历史
            collector.on('done', (finalSnapshot) => {
                // 从 history 中提取本轮产生的 assistant 消息
                for (const item of finalSnapshot.history) {
                    if (item.type === 'message' && item.role === 'assistant') {
                        messagesRef.current = [
                            ...messagesRef.current,
                            { role: 'assistant' as const, content: item.content },
                        ];
                    }
                }
            });

            collector.start();
        },
        [agent],
    );

    const abort = useCallback(() => {
        collectorRef.current?.abort();
    }, []);

    useEffect(() => {
        if (initialQuery !== null) {
            run(initialQuery);
        }
    }, []);

    return { snapshot, run, abort };
}
```

- [ ] **Step 3: EventCollector 的 done 回调需要实际触发**

检查 `event-collector.ts` 中 `start()` 方法，确认 `doneListeners` 在循环结束后被调用（已有此逻辑，line 199-201）。确认无需改动。

- [ ] **Step 4: AgentTUI 保持 history 连续性**

当前 `AgentTUI` 的 `handleSubmit` 直接调用 `run(query)`，由于 `useAgentEvents` 已经处理了消息累积，`AgentTUI.tsx` 不需要额外改动。但需要确保 snapshot 在新一轮开始时保留旧 history 而不是重置。

修改 `packages/tui/src/hooks/use-agent-events.ts` 中的 `run` 回调，在创建新 collector 前保存当前 history：

在 `run` 回调开头、`collectorRef.current?.abort()` 之后添加：

```typescript
// 保留已有 history 给新的 snapshot
const previousHistory = snapshot.history;
```

注意：这里有闭包问题。更好的方案是在 `createEventCollector` 中支持传入初始 history。

修改 `createEventCollector` 签名添加可选的 `initialHistory`:

```typescript
export function createEventCollector(
    agent: Pick<BaseAgent, 'run'>,
    input: string | Message[],
    initialHistory?: HistoryItem[],
): EventCollector {
```

然后 `let snapshot = createInitialSnapshot()` 改为：

```typescript
let snapshot = initialHistory
    ? { ...createInitialSnapshot(), history: initialHistory }
    : createInitialSnapshot();
```

在 `useAgentEvents` 的 `run` 中传入当前 history：

```typescript
const collector = createEventCollector(agent, messagesRef.current, snapshot.history);
```

这样新一轮对话的 UI 保留了之前的聊天记录。

- [ ] **Step 5: 运行类型检查**

Run: `pnpm typecheck 2>&1 | tail -20`
Expected: 无类型错误

- [ ] **Step 6: 提交**

```bash
git add packages/tui/src/adapter/event-collector.ts packages/tui/src/hooks/use-agent-events.ts
git commit -m "feat(tui): support multi-turn conversation by accumulating message history"
```

---

### Task 4: 改进 Plan 格式 — 让输出更像 TODO List

**问题**：LLM 输出的"计划"更像描述文段，不像结构化的待办清单。需要两方面改进：

1. 给 LLM 更明确的格式指令（系统提示注入）
2. 改进 `parsePlan()` 使其更健壮

**Files:**

- Modify: `packages/core/src/agent/plan-and-execute-agent.ts`
- Modify: `packages/core/src/agent/plan-and-execute-agent.test.ts`

- [ ] **Step 1: 添加计划解析的边界测试**

在 `packages/core/src/agent/plan-and-execute-agent.test.ts` 中添加 `parsePlan` 的测试。由于 `parsePlan` 是 private 方法，通过一个集成场景测试更合适。但为了直接测试解析逻辑，把 `parsePlan` 改为 `protected` 并创建一个测试子类：

````typescript
describe('plan parsing', () => {
    // 创建测试子类以访问 protected parsePlan
    class TestablePlanAgent extends PlanAndExecuteAgent {
        testParsePlan(text: string) {
            return (this as any).parsePlan(text);
        }
    }

    const createTestAgent = () =>
        new TestablePlanAgent({
            provider: mockProvider([]),
            model: 'test',
        });

    it('should parse numbered list with period', () => {
        const plan = createTestAgent().testParsePlan(
            '1. 检查环境配置\n2. 部署 API 服务\n3. 运行健康检查',
        );
        expect(plan.steps).toHaveLength(3);
        expect(plan.steps[0].description).toBe('检查环境配置');
        expect(plan.steps[2].description).toBe('运行健康检查');
    });

    it('should parse numbered list with parenthesis', () => {
        const plan = createTestAgent().testParsePlan('1) First step\n2) Second step');
        expect(plan.steps).toHaveLength(2);
    });

    it('should parse bullet list', () => {
        const plan = createTestAgent().testParsePlan('- Step A\n- Step B\n- Step C');
        expect(plan.steps).toHaveLength(3);
    });

    it('should ignore non-step lines (headings, blank lines, descriptions)', () => {
        const text = [
            '## 部署计划',
            '',
            '以下是具体步骤：',
            '',
            '1. 检查服务状态',
            '2. 备份数据库',
            '3. 执行部署',
            '',
            '请确认后执行。',
        ].join('\n');

        const plan = createTestAgent().testParsePlan(text);
        expect(plan.steps).toHaveLength(3);
        expect(plan.steps[0].description).toBe('检查服务状态');
    });

    it('should extract steps from ```plan code block', () => {
        const text = [
            '根据分析，制定以下计划：',
            '',
            '```plan',
            '1. 更新配置文件',
            '2. 重启服务',
            '3. 验证接口',
            '```',
            '',
            '以上就是计划。',
        ].join('\n');

        const plan = createTestAgent().testParsePlan(text);
        expect(plan.steps).toHaveLength(3);
    });

    it('should treat unstructured text as single step', () => {
        const plan = createTestAgent().testParsePlan('直接执行部署操作即可');
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].description).toBe('直接执行部署操作即可');
    });

    it('all steps should have pending status', () => {
        const plan = createTestAgent().testParsePlan('1. A\n2. B');
        expect(plan.steps.every((s) => s.status === 'pending')).toBe(true);
    });
});
````

- [ ] **Step 2: 运行测试确认通过（基线）**

Run: `pnpm vitest run packages/core/src/agent/plan-and-execute-agent.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: 新增测试全部 PASS

- [ ] **Step 3: 在 PlanAndExecuteAgent 中注入计划格式指令**

在 `packages/core/src/agent/plan-and-execute-agent.ts` 中，`planPhase` 进入规划循环前，给 messages 注入格式指令。

在 `runPlanningLoop` 方法的 `for` 循环之前，如果是第一次规划（`messages` 中没有计划格式指令），注入一条系统级别的 user message 到消息开头：

```typescript
private readonly PLAN_FORMAT_INSTRUCTION = `[计划格式要求]
你的计划必须使用编号列表格式，每一步是一个具体可执行的动作。
格式示例：
1. [具体动作] — [目的或预期结果]
2. [具体动作] — [目的或预期结果]
3. [具体动作] — [目的或预期结果]

要求：
- 每步只包含一个明确的操作，避免在一步中放多个动作
- 描述要具体，包含操作对象（服务名、文件名等）
- 不要写解释性段落，只写步骤列表
- 步骤总数控制在 3-10 步`;
```

在 `planPhase` 方法中，`yield* this.runPlanningLoop(...)` 之前插入格式指令到消息：

```typescript
// 注入计划格式指令，确保 LLM 输出结构化的步骤列表
messages.push({ role: 'user', content: this.PLAN_FORMAT_INSTRUCTION });
```

- [ ] **Step 4: 运行全部测试确认无回归**

Run: `pnpm vitest run packages/core/src/agent/plan-and-execute-agent.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/agent/plan-and-execute-agent.ts packages/core/src/agent/plan-and-execute-agent.test.ts
git commit -m "fix(plan): inject structured format instruction to produce TODO-list style plans"
```

---

### Task 5: 修复输出截断的 UTF-8 安全问题

**问题**：多处使用 `string.slice()` 截断输出，JavaScript 的 `slice` 按 UTF-16 code unit 切割，可能切断多字节字符（CJK、emoji）导致乱码。

**Files:**

- Create: `packages/core/src/utils/safe-truncate.ts`
- Create: `packages/core/src/utils/safe-truncate.test.ts`
- Modify: `packages/core/src/tools/builtin/execute-shell.ts`
- Modify: `packages/core/src/tools/builtin/web-fetch.ts`
- Modify: `packages/core/src/context/processors/tool-output-truncator.ts`

- [ ] **Step 1: 创建 safeTruncate 工具函数 — 写测试**

创建 `packages/core/src/utils/safe-truncate.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { safeTruncate } from './safe-truncate.js';

describe('safeTruncate', () => {
    it('should not truncate short strings', () => {
        expect(safeTruncate('hello', 10)).toBe('hello');
    });

    it('should truncate ASCII strings at exact boundary', () => {
        expect(safeTruncate('abcdef', 3)).toBe('abc');
    });

    it('should not split surrogate pairs (emoji)', () => {
        // 🎉 is a surrogate pair (2 UTF-16 code units)
        const str = 'ab🎉cd';
        // slice(0, 3) would cut the emoji in half
        const result = safeTruncate(str, 3);
        // Should either include the full emoji or stop before it
        expect(result).toBe('ab');
    });

    it('should handle CJK characters safely', () => {
        const str = '你好世界测试';
        const result = safeTruncate(str, 4);
        // Each CJK char is 1 code unit, so this should work fine
        expect(result).toBe('你好世界');
    });

    it('should handle mixed content', () => {
        const str = 'Hello 你好 🎉 world';
        const result = safeTruncate(str, 9);
        // 'Hello 你好 ' = 9 chars
        expect(result.length).toBeLessThanOrEqual(9);
        // Should not end with a broken surrogate
        expect(result).not.toMatch(/[\uD800-\uDBFF]$/);
    });

    it('should return empty string for maxLength 0', () => {
        expect(safeTruncate('hello', 0)).toBe('');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/src/utils/safe-truncate.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 safeTruncate**

创建 `packages/core/src/utils/safe-truncate.ts`：

```typescript
/**
 * UTF-16 安全的字符串截断。
 *
 * JavaScript 的 string.slice() 按 UTF-16 code unit 切割，
 * 可能把 surrogate pair（如 emoji）切成一半导致乱码。
 * 此函数确保截断位置不会落在 surrogate pair 中间。
 */
export function safeTruncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    if (maxLength <= 0) return '';

    // 检查截断位置是否落在 high surrogate 上
    // high surrogate: 0xD800–0xDBFF
    const charAtBoundary = str.charCodeAt(maxLength - 1);
    if (charAtBoundary >= 0xd800 && charAtBoundary <= 0xdbff) {
        // 截断位置是 high surrogate，后退一位避免切断 pair
        return str.slice(0, maxLength - 1);
    }

    return str.slice(0, maxLength);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/core/src/utils/safe-truncate.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: ALL PASS

- [ ] **Step 5: 替换 execute-shell.ts 中的 slice**

在 `packages/core/src/tools/builtin/execute-shell.ts` 中：

- 添加 import: `import { safeTruncate } from '../../utils/safe-truncate.js';`
- 替换 `s.slice(0, MAX_OUTPUT_LENGTH)` 为 `safeTruncate(s, MAX_OUTPUT_LENGTH)`

- [ ] **Step 6: 替换 web-fetch.ts 中的 slice**

在 `packages/core/src/tools/builtin/web-fetch.ts` 中：

- 添加 import: `import { safeTruncate } from '../../utils/safe-truncate.js';`
- 替换 `text.slice(0, maxLength)` 为 `safeTruncate(text, maxLength)`

- [ ] **Step 7: 替换 tool-output-truncator.ts 中的 slice**

在 `packages/core/src/context/processors/tool-output-truncator.ts` 中：

- 添加 import: `import { safeTruncate } from '../../utils/safe-truncate.js';`
- 替换所有 `part.content.slice(0, headLen)` 为 `safeTruncate(part.content, headLen)`
- 替换 `part.content.slice(-tailLen)` — 这个需要尾部截取，保持 `slice(-tailLen)` 即可（尾部截断的起始位置不会切断 pair）

- [ ] **Step 8: 运行全量测试**

Run: `pnpm test 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 9: 提交**

```bash
git add packages/core/src/utils/safe-truncate.ts packages/core/src/utils/safe-truncate.test.ts packages/core/src/tools/builtin/execute-shell.ts packages/core/src/tools/builtin/web-fetch.ts packages/core/src/context/processors/tool-output-truncator.ts
git commit -m "fix: use UTF-16 safe truncation to prevent garbled output on multi-byte characters"
```

---

### Task 6: 全量验证 + 类型检查

- [ ] **Step 1: 运行全量测试**

Run: `pnpm test 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 2: 运行类型检查**

Run: `pnpm typecheck 2>&1 | tail -20`
Expected: 无错误

- [ ] **Step 3: 运行格式检查**

Run: `pnpm format:check 2>&1 | tail -10`
Expected: 无格式问题（如有则运行 `pnpm format` 修复）
