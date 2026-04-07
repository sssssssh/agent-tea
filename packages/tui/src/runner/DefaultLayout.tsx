import React from 'react';
import { Box } from 'ink';

export interface LayoutProps {
    history: React.ReactNode;
    statusBar: React.ReactNode;
    composer: React.ReactNode;
    approval: React.ReactNode | null;
}

export function DefaultLayout({ history, statusBar, composer, approval }: LayoutProps) {
    return (
        <Box flexDirection="column" height="100%">
            {statusBar}
            <Box flexDirection="column" flexGrow={1}>
                {history}
            </Box>
            {approval}
            {composer}
        </Box>
    );
}
