import type { BaseAgent, AgentEvent, Message } from '@agent-tea/sdk';
import {
    type AgentSnapshot,
    type HistoryItem,
    type ToolCallItem,
    createInitialSnapshot,
} from './types.js';

type SnapshotListener = (snapshot: AgentSnapshot) => void;
type DoneListener = (snapshot: AgentSnapshot) => void;

export interface EventCollector {
    on(event: 'snapshot', listener: SnapshotListener): void;
    on(event: 'done', listener: DoneListener): void;
    start(): Promise<AgentSnapshot>;
    abort(): void;
}

/**
 * 创建事件收集器，将 Agent 事件流转为不可变快照。
 *
 * @param agent   - Agent 实例（仅需 run 方法）
 * @param input   - 用户输入，支持纯字符串或完整消息历史（多轮对话场景）
 * @param initialHistory - 可选的初始 UI 历史，用于跨轮次保持显示连续性
 */
export function createEventCollector(
    agent: Pick<BaseAgent, 'run'>,
    input: string | Message[],
    initialHistory?: HistoryItem[],
): EventCollector {
    const snapshotListeners: SnapshotListener[] = [];
    const doneListeners: DoneListener[] = [];
    const abortController = new AbortController();

    let snapshot = initialHistory
        ? { ...createInitialSnapshot(), history: initialHistory }
        : createInitialSnapshot();
    const pendingToolCalls = new Map<
        string,
        { name: string; args: Record<string, unknown>; startTime: number }
    >();

    function emit() {
        for (const listener of snapshotListeners) {
            listener(snapshot);
        }
    }

    /** 将累积中的流式文本刷入 history，重置 streaming 状态 */
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
                    // assistant 消息逐块累积到 streaming
                    snapshot = { ...snapshot, streaming: (snapshot.streaming ?? '') + event.content };
                } else {
                    // 用户消息直接追加到 history
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
                // 工具调用前先把未完成的流式文本刷入 history
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
                        outputTokens:
                            snapshot.usage.outputTokens + (event.usage.outputTokens ?? 0),
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
                    history: [
                        ...snapshot.history,
                        { type: 'plan', steps: [...event.plan.steps] },
                    ],
                };
                break;

            case 'step_start':
            case 'step_complete':
            case 'step_failed': {
                // 找到最近的 plan item，更新对应步骤状态
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

            // 这些事件不影响快照状态
            case 'state_change':
            case 'execution_paused':
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
            for await (const event of agent.run(input, abortController.signal)) {
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
