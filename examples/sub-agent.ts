/**
 * Sub-agent example.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/sub-agent.ts
 *
 * This example demonstrates:
 * 1. Creating a sub-agent as a tool
 * 2. Main agent delegating work to a specialized sub-agent
 */

import { Agent, tool, subAgent, z } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

// A simple "knowledge base" tool for the research sub-agent
const lookupKB = tool(
  {
    name: 'lookup_knowledge',
    description: 'Look up information from the knowledge base',
    parameters: z.object({
      topic: z.string().describe('Topic to look up'),
    }),
  },
  async ({ topic }) => {
    // Simulated knowledge base
    const kb: Record<string, string> = {
      't-agent': 'T-Agent is a flexible, extensible AI agent framework built with TypeScript.',
      typescript: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
      openai: 'OpenAI provides API access to large language models like GPT-4.',
    };
    const key = Object.keys(kb).find((k) => topic.toLowerCase().includes(k));
    return key ? kb[key] : `No information found for: ${topic}`;
  },
);

// Create a research sub-agent
const researcher = subAgent({
  name: 'research',
  description: 'Research a topic in depth using the knowledge base. Returns a detailed summary.',
  provider,
  model: process.env.MODEL || 'gpt-4o-mini',
  tools: [lookupKB],
  systemPrompt: 'You are a research assistant. Use the knowledge base to gather information and provide a thorough summary.',
});

// Main agent that delegates research to the sub-agent
const agent = new Agent({
  provider,
  model: process.env.MODEL || 'gpt-4o-mini',
  tools: [researcher],
  systemPrompt: '你是一个项目经理。当用户询问技术问题时，委托给研究助手去查找信息。用中文回答。',
});

async function main() {
  const query = process.argv[2] || '帮我了解一下 T-Agent 框架是什么？';
  console.log(`\n> ${query}\n`);

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`Assistant: ${event.content}`);
        break;
      case 'tool_request':
        console.log(`  [Delegating to] ${event.toolName}`);
        break;
      case 'tool_response':
        console.log(`  [Sub-agent result] ${event.content.slice(0, 200)}...`);
        break;
      case 'error':
        console.error(`  [Error] ${event.message}`);
        break;
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
