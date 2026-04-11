import { Agent, tool, subAgent, z } from '../packages/sdk/src/index.js';
import { createEventCollector } from '../packages/tui/src/adapter/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

// 研究子 Agent
const researchAgent = new Agent({
    provider,
    model: process.env.MODEL || 'gpt-4o-mini',
    systemPrompt: '你是一个研究助手，简洁回答问题。',
});

const researchTool = subAgent({
    agent: researchAgent,
    name: 'research',
    description: '委派研究任务给专门的研究 Agent',
});

// 主 Agent
const agent = new Agent({
    provider,
    model: process.env.MODEL || 'gpt-4o-mini',
    tools: [researchTool],
    systemPrompt: '你是项目经理，遇到需要研究的问题就委派给 research 工具。',
});

const query = process.argv[2] || '帮我研究一下 TypeScript 5.0 的新特性';
console.log(`\n查询: ${query}\n`);

const collector = createEventCollector(agent, query);

collector.on('snapshot', (snapshot) => {
    const lastItem = snapshot.history.at(-1);
    if (lastItem?.type === 'tool_call' && lastItem.name === 'research') {
        console.log(`[SubAgent] research 完成 (${lastItem.durationMs}ms)`);
    }
});

const result = await collector.start();
console.log('\n--- 最终结果 ---');
const lastMessage = result.history
    .filter((h) => h.type === 'message' && h.role === 'assistant')
    .at(-1);
if (lastMessage?.type === 'message') {
    console.log(lastMessage.content);
}
