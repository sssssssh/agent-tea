/**
 * AgentStateMachine —— Agent 阶段状态管理
 *
 * 记录 Agent 当前处于哪个阶段，限制只能按合法路径转换。
 * 将状态转换逻辑集中管理，避免 if/else 散落在各处。
 *
 * 架构位置：Core 层的 Agent 子模块，被 BaseAgent 持有和驱动。
 */

import type { AgentState, StateTransition } from './types.js';

type TransitionListener = (from: AgentState, to: AgentState) => void;

export class AgentStateMachine {
    private state: AgentState = 'idle';
    private readonly transitions: StateTransition[];
    private readonly listeners: TransitionListener[] = [];

    constructor(transitions: StateTransition[]) {
        this.transitions = transitions;
    }

    /** 当前状态 */
    get current(): AgentState {
        return this.state;
    }

    /**
     * 尝试转换到目标状态。
     * 查找匹配的转换规则，检查 guard 条件，非法转换抛异常。
     */
    transition(to: AgentState): void {
        const valid = this.transitions.some((t) => {
            const fromMatch = Array.isArray(t.from)
                ? t.from.includes(this.state)
                : t.from === this.state;
            return fromMatch && t.to === to && (t.guard ? t.guard() : true);
        });

        if (!valid) {
            throw new Error(`Invalid state transition: ${this.state} → ${to}`);
        }

        const from = this.state;
        this.state = to;

        for (const listener of this.listeners) {
            listener(from, to);
        }
    }

    /** 监听状态变化，返回取消订阅函数 */
    onTransition(listener: TransitionListener): () => void {
        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index >= 0) this.listeners.splice(index, 1);
        };
    }
}
