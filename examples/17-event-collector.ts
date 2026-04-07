import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { createEventCollector } from '../packages/tui/src/adapter/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const weatherTool = tool({
    name: 'getWeather',
    description: '获取指定城市的天气信息',
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `${city}：晴，25°C`,
});

const agent = new Agent({
    provider,
    model: 'gpt-4o-mini',
    tools: [weatherTool],
    systemPrompt: '你是一个天气助手。',
});

const query = process.argv[2] || '北京今天天气怎么样？';
console.log(`\n查询: ${query}\n`);

const collector = createEventCollector(agent, query);

collector.on('snapshot', (snapshot) => {
    const toolCalls = snapshot.history.filter((h) => h.type === 'tool_call').length;
    process.stdout.write(
        `\r[${snapshot.status}] history: ${snapshot.history.length} items, tools: ${toolCalls}, tokens: ${snapshot.usage.inputTokens + snapshot.usage.outputTokens}`,
    );
});

const result = await collector.start();
console.log('\n\n--- 最终结果 ---');
const lastMessage = result.history
    .filter((h) => h.type === 'message' && h.role === 'assistant')
    .at(-1);
if (lastMessage?.type === 'message') {
    console.log(lastMessage.content);
}
console.log(
    `\nToken 用量: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`,
);
