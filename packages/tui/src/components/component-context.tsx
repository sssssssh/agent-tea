import React, { createContext, useContext } from 'react';
import type { AgentStatus } from '../adapter/types.js';
import type { ApprovalRequestEvent, PlanStep } from '@agent-tea/sdk';

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

export interface ComponentMap {
    userMessage: React.ComponentType<UserMessageProps>;
    agentMessage: React.ComponentType<AgentMessageProps>;
    toolCallCard: React.ComponentType<ToolCallCardProps>;
    approvalDialog: React.ComponentType<ApprovalDialogProps>;
    planView: React.ComponentType<PlanViewProps>;
    errorMessage: React.ComponentType<ErrorMessageProps>;
    statusBar: React.ComponentType<StatusBarProps>;
}

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
