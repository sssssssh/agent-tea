import React from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { AgentTUI } from '../packages/tui/src/index.js';
import type { ToolCallCardProps } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

// 自定义 ToolCallCard：始终展开，带彩色边框
function MyToolCard({ name, args, result, isError, durationMs }: ToolCallCardProps) {
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={isError ? 'red' : 'green'}
            paddingX={1}
            marginBottom={1}
        >
            <Text bold>
                {name} <Text color="gray">({(durationMs / 1000).toFixed(1)}s)</Text>
            </Text>
            <Text color="gray">Args: {JSON.stringify(args)}</Text>
            <Text color={isError ? 'red' : 'white'}>Result: {result}</Text>
        </Box>
    );
}

const weatherTool = tool({
    name: 'getWeather',
    description: '获取天气',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `${city}：多云，22°C`,
});

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [weatherTool],
    systemPrompt: '你是天气助手。',
});

render(
    <AgentTUI
        agent={agent}
        components={{ toolCallCard: MyToolCard }}
        initialQuery="北京和上海的天气分别怎么样？"
    />,
);
