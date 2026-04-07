import { useCallback } from 'react';
import type { BaseAgent } from '@agent-tea/sdk';

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
