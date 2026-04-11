import React from 'react';
import { render } from 'ink';
import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { AgentTUI } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const weatherTool = tool({
    name: 'getWeather',
    description: '获取指定城市的天气信息',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `${city}：晴，25°C，湿度 60%`,
});

const agent = new Agent({
    provider,
    model: process.env.MODEL || 'gpt-4o-mini',
    tools: [weatherTool],
    systemPrompt: '你是一个天气助手。',
});

render(<AgentTUI agent={agent} />);
