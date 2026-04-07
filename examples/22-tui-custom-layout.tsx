import React from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { Agent, readFile, listDirectory } from '../packages/sdk/src/index.js';
import { AgentTUI } from '../packages/tui/src/index.js';
import type { LayoutProps } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

// 双面板布局：左边聊天，右边信息面板
function DualPanelLayout({ history, statusBar, composer, approval }: LayoutProps) {
    return (
        <Box flexDirection="column" height="100%">
            {statusBar}
            <Box flexGrow={1}>
                <Box flexDirection="column" width="70%">
                    {history}
                </Box>
                <Box
                    flexDirection="column"
                    width="30%"
                    borderStyle="single"
                    borderColor="gray"
                    paddingX={1}
                >
                    <Text bold color="cyan">
                        Info Panel
                    </Text>
                    <Text color="gray">Custom layout demo</Text>
                </Box>
            </Box>
            {approval}
            {composer}
        </Box>
    );
}

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [readFile, listDirectory],
    systemPrompt: '你是一个代码分析助手。',
});

render(
    <AgentTUI
        agent={agent}
        layout={DualPanelLayout}
        initialQuery="分析当前目录的项目结构"
    />,
);
