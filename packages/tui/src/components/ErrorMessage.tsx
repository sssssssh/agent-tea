import React from 'react';
import { Box, Text } from 'ink';
import type { ErrorMessageProps } from './component-context.js';

export function ErrorMessage({ message, fatal }: ErrorMessageProps) {
    return (
        <Box marginBottom={1}>
            <Text color="red">
                {fatal ? '✗ Fatal: ' : '⚠ '}
                {message}
            </Text>
        </Box>
    );
}
