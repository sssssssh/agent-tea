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
import type { AgentSnapshot } from '../adapter/types.js';

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
    onComplete?: (snapshot: AgentSnapshot) => void;
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
