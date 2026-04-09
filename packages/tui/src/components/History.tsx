import React from 'react';
import { Box } from 'ink';
import { useComponents } from './component-context.js';
import type { HistoryItem } from '../adapter/types.js';

export interface HistoryProps {
    items: HistoryItem[];
    streaming?: string | null;
}

export function History({ items, streaming }: HistoryProps) {
    const components = useComponents();

    return (
        <Box flexDirection="column">
            {items.map((item) => {
                switch (item.type) {
                    case 'message':
                        return item.role === 'user' ? (
                            <components.userMessage key={item.id} content={item.content} />
                        ) : (
                            <components.agentMessage key={item.id} content={item.content} />
                        );
                    case 'tool_call':
                        return (
                            <components.toolCallCard
                                key={item.id}
                                requestId={item.requestId}
                                name={item.name}
                                args={item.args}
                                result={item.result}
                                isError={item.isError}
                                durationMs={item.durationMs}
                            />
                        );
                    case 'plan':
                        return <components.planView key={item.id} steps={item.steps} />;
                    case 'error':
                        return (
                            <components.errorMessage
                                key={item.id}
                                message={item.message}
                                fatal={item.fatal}
                            />
                        );
                }
            })}
            {streaming && <components.agentMessage content={streaming} streaming />}
        </Box>
    );
}
