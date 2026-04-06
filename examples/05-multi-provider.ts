/**
 * 05 - 多 Provider：同一框架适配不同 LLM 厂商
 *
 * 前置知识：01-hello-agent（Agent、tool 基础）
 *
 * 本示例新概念：
 * - 多 Provider：OpenAI、Anthropic、Gemini 三大厂商适配器
 * - 厂商无关设计：同一套工具和事件消费代码，切换 Provider 即可换 LLM
 * - 命令行参数选择 Provider
 *
 * 运行方式：
 *   # 使用 OpenAI（默认）
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/05-multi-provider.ts openai
 *
 *   # 使用 Anthropic Claude
 *   ANTHROPIC_API_KEY=sk-ant-xxx npx tsx examples/05-multi-provider.ts anthropic
 *
 *   # 使用 Google Gemini
 *   GEMINI_API_KEY=xxx npx tsx examples/05-multi-provider.ts gemini
 *
 *   # 使用兼容 OpenAI API 的服务
 *   OPENAI_API_KEY=your-key OPENAI_BASE_URL=https://your-api-base \
 *   MODEL=your-model npx tsx examples/05-multi-provider.ts openai
 */

import { Agent, tool, z } from '../packages/sdk/src/index.js';
import type { LLMProvider } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';
import { AnthropicProvider } from '../packages/provider-anthropic/src/index.js';
import { GeminiProvider } from '../packages/provider-gemini/src/index.js';

// ============================================================
// 定义通用的工具集 —— 与 Provider 无关
// 这是框架厂商无关设计的核心优势：
// 工具定义一次，所有 Provider 都能用
// ============================================================

const calculator = tool(
  {
    name: 'calculate',
    description: '计算数学表达式',
    parameters: z.object({
      expression: z.string().describe('数学表达式，如 "2 + 3 * 4"'),
    }),
  },
  async ({ expression }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return `${expression} = ${result}`;
    } catch {
      return { content: `无法计算: ${expression}`, isError: true };
    }
  },
);

const getTime = tool(
  {
    name: 'get_current_time',
    description: '获取当前日期和时间',
    parameters: z.object({}),
  },
  async () => {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  },
);

// 通用工具集
const tools = [calculator, getTime];

// ============================================================
// Provider 配置表
// 每个 Provider 的构造参数略有不同，但都实现了 LLMProvider 接口
// ============================================================

interface ProviderConfig {
  name: string;
  provider: LLMProvider;
  model: string;
}

/** 根据名称创建对应的 Provider 配置 */
function getProviderConfig(name: string): ProviderConfig {
  switch (name) {
    case 'openai':
      return {
        name: 'OpenAI',
        provider: new OpenAIProvider({
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: process.env.OPENAI_BASE_URL,
        }),
        model: process.env.MODEL || 'gpt-4o-mini',
      };

    case 'anthropic':
      return {
        name: 'Anthropic',
        provider: new AnthropicProvider({
          apiKey: process.env.ANTHROPIC_API_KEY,
        }),
        model: process.env.MODEL || 'claude-sonnet-4-20250514',
      };

    case 'gemini':
      return {
        name: 'Google Gemini',
        provider: new GeminiProvider({
          apiKey: process.env.GEMINI_API_KEY,
        }),
        model: process.env.MODEL || 'gemini-2.0-flash',
      };

    default:
      console.error(`未知的 Provider: ${name}`);
      console.error('可选值: openai, anthropic, gemini');
      process.exit(1);
  }
}

// ============================================================
// 通用的 Agent 运行函数 —— 事件消费代码完全相同
// 这再次体现了框架的厂商无关特性：
// 不管底层用哪个 LLM，上层代码零改动
// ============================================================

async function runWithProvider(config: ProviderConfig, query: string) {
  console.log(`\n========================================`);
  console.log(`Provider: ${config.name}`);
  console.log(`模型: ${config.model}`);
  console.log(`========================================\n`);

  // 同一套工具和系统提示，只是 Provider 和 model 不同
  const agent = new Agent({
    provider: config.provider,
    model: config.model,
    tools,
    systemPrompt: '你是一个有用的助手。用中文回答问题。',
  });

  console.log(`> ${query}\n`);

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`[助手] ${event.content}`);
        break;

      case 'tool_request':
        console.log(`[工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
        break;

      case 'tool_response':
        console.log(`[工具结果] ${event.content}`);
        break;

      case 'usage':
        console.log(`[用量] 输入=${event.usage.inputTokens} 输出=${event.usage.outputTokens}`);
        break;

      case 'error':
        console.error(`[错误] ${event.message}`);
        break;
    }
  }

  console.log('\n完成。');
}

// ============================================================
// 主函数：从命令行参数选择 Provider
// ============================================================

async function main() {
  const providerName = process.argv[2] || 'openai';
  const query = process.argv[3] || '现在几点了？然后帮我算 2024 * 365';

  const config = getProviderConfig(providerName);
  await runWithProvider(config, query);
}

main().catch(console.error);
