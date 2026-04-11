import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { createEventCollector } from '../packages/tui/src/adapter/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const calcTool = tool({
    name: 'calculate',
    description: '计算数学表达式',
    parameters: z.object({ expression: z.string() }),
    execute: async ({ expression }) => {
        try {
            return String(Function(`"use strict"; return (${expression})`)());
        } catch {
            return '计算错误';
        }
    },
});

const agent = new Agent({
    provider,
    model: process.env.MODEL || 'gpt-4o-mini',
    tools: [calcTool],
    systemPrompt: '你是一个数学助手，用 calculate 工具计算后回答。',
});

const queries = ['123 * 456 等于多少？', '圆周率的前 10 位是什么？', '2 的 10 次方是多少？'];

console.log(`\n批量运行 ${queries.length} 个查询\n`);

const results = await Promise.all(
    queries.map(async (query) => {
        const collector = createEventCollector(agent, query);
        const snapshot = await collector.start();
        const answer = snapshot.history
            .filter((h) => h.type === 'message' && h.role === 'assistant')
            .at(-1);
        return {
            query,
            answer: answer?.type === 'message' ? answer.content : '(无回复)',
            tokens: snapshot.usage.inputTokens + snapshot.usage.outputTokens,
        };
    }),
);

for (const r of results) {
    console.log(`Q: ${r.query}`);
    console.log(`A: ${r.answer}`);
    console.log(`   (${r.tokens} tokens)\n`);
}
