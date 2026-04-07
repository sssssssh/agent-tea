/**
 * 示例 16: Skill/Agent 自动发现
 *
 * 演示从文件系统自动加载 Skill 和 Agent 定义。
 *
 * 准备工作（创建示例文件）：
 *
 * 1. 全局 Skill — ~/.agent-tea/skills/translator/SKILL.md
 *    ---
 *    name: translator
 *    description: 翻译助手
 *    ---
 *    将用户输入翻译为指定语言，保持专业术语准确。
 *
 * 2. 项目级 Skill — .agent-tea/skills/code-review/SKILL.md
 *    ---
 *    name: code-review
 *    description: 代码审查
 *    tools:
 *      - read_file
 *      - grep
 *    ---
 *    审查代码质量，关注类型安全、错误处理和代码规范。
 *
 * 3. 项目级 Agent — .agent-tea/agents/researcher/AGENT.md
 *    ---
 *    name: researcher
 *    description: 技术研究员，负责调研和对比分析
 *    tools:
 *      - web_fetch
 *      - grep
 *    maxIterations: 8
 *    ---
 *    你是技术研究员。用工具查找信息，对比多个方案，给出推荐。
 *
 * 运行：pnpm example:16
 */

import { Agent, discover } from '@agent-tea/sdk';
import { OpenAIProvider } from '@agent-tea/provider-openai';

async function main() {
  const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
  const model = 'gpt-4o-mini';

  // 自动发现所有 Skill 和 Agent
  console.log('--- 扫描 ~/.agent-tea/ 和 .agent-tea/ ---\n');
  const found = await discover({ provider, model });

  console.log(`发现 ${found.skills.length} 个 Skill:`);
  for (const s of found.skills) {
    console.log(`  - ${s.name}: ${s.description}`);
  }

  console.log(`\n发现 ${found.agents.length} 个 Agent:`);
  for (const a of found.agents) {
    console.log(`  - ${a.name}: ${a.description}`);
  }

  console.log(`\n合计 ${found.tools.length} 个可用工具\n`);

  if (found.tools.length === 0) {
    console.log('未发现任何 Skill 或 Agent。请先创建示例文件，参考本文件顶部注释。');
    return;
  }

  // 创建 Agent 并注入发现的能力
  const agent = new Agent({
    provider,
    model,
    tools: found.tools,
    systemPrompt: `你是一个多能力助手。\n\n${found.instructions}`,
  });

  const query = '帮我分析一下当前项目的代码结构';
  console.log(`用户: ${query}\n`);

  for await (const event of agent.run(query)) {
    if (event.type === 'message' && event.role === 'assistant') {
      process.stdout.write(event.content);
    }
    if (event.type === 'tool_request') {
      console.log(`\n[调用工具] ${event.toolName}`);
    }
  }
  console.log();
}

main().catch(console.error);
