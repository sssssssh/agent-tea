import React from 'react';
import { Box, Text } from 'ink';
import type { PlanViewProps } from './component-context.js';
import type { PlanStep } from '@agent-tea/sdk';

const STATUS_ICON: Record<PlanStep['status'], string> = {
    pending: '○',
    executing: '▶',
    completed: '✓',
    failed: '✗',
    skipped: '–',
};

const STATUS_COLOR: Record<PlanStep['status'], string> = {
    pending: 'gray',
    executing: 'yellow',
    completed: 'green',
    failed: 'red',
    skipped: 'gray',
};

export function PlanView({ steps }: PlanViewProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color="magenta">
                Plan
            </Text>
            {steps.map((step) => (
                <Box key={step.index}>
                    <Text color={STATUS_COLOR[step.status]}>{STATUS_ICON[step.status]} </Text>
                    <Text color={step.status === 'pending' ? 'gray' : 'white'}>
                        {step.index + 1}. {step.description}
                    </Text>
                </Box>
            ))}
        </Box>
    );
}
