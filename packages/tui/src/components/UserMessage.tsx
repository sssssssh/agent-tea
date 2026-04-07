import React from 'react';
import { Box, Text } from 'ink';
import type { UserMessageProps } from './component-context.js';

export function UserMessage({ content }: UserMessageProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color="blue">
                You
            </Text>
            <Text>{content}</Text>
        </Box>
    );
}
