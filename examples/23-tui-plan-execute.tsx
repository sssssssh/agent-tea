import React from 'react';
import { render } from 'ink';
import { PlanAndExecuteAgent, readFile, listDirectory, grep } from '../packages/sdk/src/index.js';
import { AgentTUI } from '../packages/tui/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const agent = new PlanAndExecuteAgent({
    provider,
    model: process.env.MODEL || 'gpt-4o',
    tools: [readFile, listDirectory, grep],
    systemPrompt: '你是一个代码分析专家。先制定计划，再逐步执行。',
    onPlanCreated: async (plan) => {
        // TUI 会自动显示 plan_created 事件
        return { approved: true };
    },
});

render(<AgentTUI agent={agent} initialQuery={process.argv[2] || '分析这个项目的架构设计'} />);
