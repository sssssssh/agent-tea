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
            collectorRef.current?.abort();

            const collector = createEventCollector(agent, query);
            collectorRef.current = collector;

            collector.on('snapshot', (s) => setSnapshot(s));
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
