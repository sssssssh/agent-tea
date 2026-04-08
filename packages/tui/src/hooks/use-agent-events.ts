import { useState, useCallback, useRef, useEffect } from 'react';
import type { BaseAgent, Message } from '@agent-tea/sdk';
import { createEventCollector, type EventCollector } from '../adapter/index.js';
import { type AgentSnapshot, type HistoryItem, createInitialSnapshot } from '../adapter/types.js';

/**
 * Agent 事件流的 React hook，支持多轮对话。
 *
 * 每次 run(query) 会将用户消息追加到 messagesRef 中，
 * 并将完整的消息历史传给 Agent（而非仅当前输入），实现上下文连续。
 * 同时传入当前 UI 历史，保证跨轮次的显示连续性。
 */
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
    // 累积完整消息历史，用于传给 Agent 实现多轮对话
    const messagesRef = useRef<Message[]>([]);
    // 用 ref 追踪最新的 UI 历史，避免 run 回调中的闭包过期问题
    const historyRef = useRef<HistoryItem[]>([]);

    // 同步 snapshot.history 到 ref
    historyRef.current = snapshot.history;

    const run = useCallback(
        (query: string) => {
            collectorRef.current?.abort();

            // 追加新用户消息到对话历史
            messagesRef.current = [
                ...messagesRef.current,
                { role: 'user' as const, content: query },
            ];

            // 将完整消息历史 + 当前 UI 历史传给收集器
            const currentHistory = historyRef.current;
            const collector = createEventCollector(agent, messagesRef.current, currentHistory);
            collectorRef.current = collector;

            collector.on('snapshot', (s) => setSnapshot(s));

            // Agent 完成后，将本轮 assistant 消息提取到 messagesRef，供下一轮使用
            collector.on('done', (finalSnapshot) => {
                // 从 initialHistory 之后的新条目中提取 assistant 消息
                const newItems = finalSnapshot.history.slice(currentHistory.length);
                for (const item of newItems) {
                    if (item.type === 'message' && item.role === 'assistant') {
                        messagesRef.current = [
                            ...messagesRef.current,
                            {
                                role: 'assistant' as const,
                                content: [{ type: 'text' as const, text: item.content }],
                            },
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
