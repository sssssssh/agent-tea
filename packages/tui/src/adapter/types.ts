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
