import React from 'react';
import { Box, Text } from 'ink';
import type { AgentMessageProps } from './component-context.js';

export function AgentMessage({ content, streaming = false }: AgentMessageProps) {
    return (
        <Box flexDirection="column" marginBottom={1}>
            <Text bold color="green">
                Assistant
            </Text>
            <Text>
                {content}
                {streaming ? '▊' : ''}
            </Text>
        </Box>
    );
}
