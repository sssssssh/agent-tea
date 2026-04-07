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
