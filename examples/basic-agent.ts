/**
 * Basic agent example.
 *
 * Usage (OpenAI):
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/basic-agent.ts
 *
 * Usage (Volcengine / 火山引擎):
 *   OPENAI_API_KEY=your-key OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 \
 *   MODEL=your-endpoint-id npx tsx examples/basic-agent.ts
 *
 * This example demonstrates:
 * 1. Defining tools with type-safe parameters
 * 2. Creating an agent with OpenAI-compatible provider
 * 3. Running the agent and consuming events
 */

import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// Define a simple calculator tool
const calculator = tool(
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression. Supports +, -, *, / operations.',
    parameters: z.object({
      expression: z.string().describe('The math expression to evaluate, e.g. "2 + 3 * 4"'),
    }),
  },
  async ({ expression }) => {
    try {
      // Simple and safe expression evaluator
      const result = Function(`"use strict"; return (${expression})`)();
      return `Result: ${result}`;
    } catch {
      return { content: `Cannot evaluate: ${expression}`, isError: true };
    }
  },
);

// Define a time tool
const getTime = tool(
  {
    name: 'get_current_time',
    description: 'Get the current date and time',
    parameters: z.object({}),
  },
  async () => {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  },
);

// Create the agent (supports OpenAI, Volcengine, DeepSeek, etc.)
const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL, // 留空则默认 OpenAI
  }),
  model: process.env.MODEL || 'gpt-4o-mini',
  tools: [calculator, getTime],
  systemPrompt: '你是一个有用的助手。用中文回答问题。',
});

// Run the agent
async function main() {
  const query = process.argv[2] || '现在几点了？然后帮我算一下 123 * 456';
  console.log(`\n> ${query}\n`);

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`Assistant: ${event.content}`);
        break;
      case 'tool_request':
        console.log(`  [Tool] ${event.toolName}(${JSON.stringify(event.args)})`);
        break;
      case 'tool_response':
        console.log(`  [Result] ${event.content}`);
        break;
      case 'usage':
        console.log(`  [Tokens] in=${event.usage.inputTokens} out=${event.usage.outputTokens}`);
        break;
      case 'error':
        console.error(`  [Error] ${event.message}`);
        break;
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
