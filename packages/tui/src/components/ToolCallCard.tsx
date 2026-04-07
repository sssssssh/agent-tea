import React from 'react';
import { Box, Text } from 'ink';
import type { ToolCallCardProps } from './component-context.js';

export function ToolCallCard({
    name,
    args,
    result,
    isError,
    durationMs,
    expanded = false,
}: ToolCallCardProps) {
    const durationStr = (durationMs / 1000).toFixed(1) + 's';
    const icon = isError ? '✗' : '▶';
    const iconColor = isError ? 'red' : 'cyan';

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text color={iconColor}>{icon} </Text>
                <Text bold>{name}</Text>
                <Text color="gray"> {durationStr}</Text>
            </Box>
            {expanded && (
                <Box flexDirection="column" marginLeft={2}>
                    <Text color="gray">Args: {JSON.stringify(args, null, 2)}</Text>
                    <Text color={isError ? 'red' : 'white'}>Result: {result}</Text>
                </Box>
            )}
        </Box>
    );
}
