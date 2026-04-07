import React from 'react';
import { Box, Text } from 'ink';
import type { StatusBarProps } from './component-context.js';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    idle: { label: 'idle', color: 'gray' },
    thinking: { label: 'thinking', color: 'yellow' },
    tool_executing: { label: 'executing tool', color: 'cyan' },
    waiting_approval: { label: 'waiting approval', color: 'magenta' },
    completed: { label: 'completed', color: 'green' },
    error: { label: 'error', color: 'red' },
    aborted: { label: 'aborted', color: 'red' },
};

export function StatusBar({ status, usage }: StatusBarProps) {
    const { label, color } = STATUS_LABELS[status] ?? { label: status, color: 'white' };
    const totalTokens = usage.inputTokens + usage.outputTokens;

    return (
        <Box borderStyle="single" paddingX={1} justifyContent="space-between">
            <Text>
                Status: <Text color={color}>{label}</Text>
            </Text>
            <Text>
                tokens: <Text bold>{totalTokens}</Text>
            </Text>
        </Box>
    );
}
