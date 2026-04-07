import React from 'react';
import { Box, Text } from 'ink';
import type { ApprovalDialogProps } from './component-context.js';

export function ApprovalDialog({ request, onApprove, onReject }: ApprovalDialogProps) {
    return (
        <Box
            flexDirection="column"
            borderStyle="double"
            borderColor="yellow"
            paddingX={1}
            marginY={1}
        >
            <Text bold color="yellow">
                Approval Required
            </Text>
            <Box marginTop={1} flexDirection="column">
                <Text>
                    Tool: <Text bold>{request.toolName}</Text>
                </Text>
                {request.toolDescription && (
                    <Text color="gray">{request.toolDescription}</Text>
                )}
                <Text color="gray">Args: {JSON.stringify(request.args, null, 2)}</Text>
            </Box>
            <Box marginTop={1}>
                <Text>
                    <Text color="green">[Y]</Text> Approve {'  '}
                    <Text color="red">[N]</Text> Reject
                </Text>
            </Box>
        </Box>
    );
}
