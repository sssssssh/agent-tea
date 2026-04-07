/**
 * 01 - Hello Agent：最简 Agent 入门
 *
 * 前置知识：无（这是第一个示例）
 *
 * 本示例新概念：
 * - Agent：AI 智能体，协调 LLM 和工具的核心循环
 * - tool()：工厂函数，创建类型安全的工具
 * - z (Zod)：用于定义工具参数的 Schema，同时驱动类型推导和运行时验证
 * - 事件消费：通过 for await...of 消费 Agent 产出的事件流
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/01-hello-agent.ts
 *
 *   # 使用兼容 API（火山引擎、DeepSeek 等）：
 *   OPENAI_API_KEY=your-key OPENAI_BASE_URL=https://your-api-base npx tsx examples/01-hello-agent.ts
 */

import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 第一步：定义工具
// tool() 接收两个参数：
//   1. 配置对象 { name, description, parameters }
//   2. 执行函数 (params) => Promise<string | ToolResult>
//
// parameters 用 Zod Schema 定义，框架会自动：
//   - 转换为 JSON Schema 给 LLM 理解参数格式
//   - 在运行时验证 LLM 传来的参数是否合法
//   - 推导 execute 函数的参数类型（TypeScript 层面）
// ============================================================

const echo = tool(
    {
        name: 'echo',
        description: '回显用户消息',
        parameters: z.object({
            message: z.string().describe('要回显的消息'),
        }),
    },
    async ({ message }) => `回显: ${message}`,
);

// ============================================================
// 第二步：创建 Agent
// Agent 需要三个核心配置：
//   - provider：LLM 服务适配器（这里用 OpenAI 兼容的）
//   - model：模型 ID
//   - tools：Agent 可以使用的工具列表
// ============================================================

const agent = new Agent({
    provider: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
    }),
    model: process.env.MODEL || 'gpt-4o-mini',
    tools: [echo],
    systemPrompt: '你是一个有用的助手。当用户让你回显消息时，使用 echo 工具。用中文回答。',
});

// ============================================================
// 第三步：运行 Agent 并消费事件
// Agent.run() 返回 AsyncGenerator<AgentEvent>，
// 每种事件有不同的 type，可以用 switch/case 分别处理。
//
// 这个示例只关注三种最基础的事件：
//   - message：LLM 的文本回复
//   - tool_request：LLM 请求调用某个工具
//   - tool_response：工具执行完毕后的返回结果
// ============================================================

async function main() {
    const query = process.argv[2] || '请帮我回显这条消息：Hello, Agent!';
    console.log(`\n> ${query}\n`);

    for await (const event of agent.run(query)) {
        switch (event.type) {
            case 'message':
                // LLM 产出的文本内容
                console.log(`[助手] ${event.content}`);
                break;

            case 'tool_request':
                // LLM 请求调用工具（此时工具尚未执行）
                console.log(`[工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
                break;

            case 'tool_response':
                // 工具执行完毕，返回结果
                console.log(`[工具结果] ${event.content}`);
                break;
        }
    }

    console.log('\n完成。');
}

main().catch(console.error);
