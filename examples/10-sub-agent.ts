/**
 * 示例 10 — 多 Agent 协作（Sub-Agent）
 *
 * 前置知识：01-basic-agent（Agent 基本用法）
 * 新概念：
 *   - subAgent() —— 将 Agent 包装为 Tool，父 Agent 通过工具调用委派任务
 *   - 多 Agent 层级协作 —— 项目经理分配任务给专业子 Agent
 *   - SubAgent 作为工具 —— 父 Agent 的 LLM 自行决定何时委派、委派给谁
 *
 * 场景：一个"项目经理" Agent 管理两个专业子 Agent
 *   1. 研究员 —— 有知识库查询工具，负责信息收集和分析
 *   2. 编码员 —— 有代码生成工具（模拟），负责编写代码
 *
 * 工作流：用户提需求 -> 经理分析 -> 委派研究员调研 -> 委派编码员实现 -> 经理汇总
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/10-sub-agent.ts
 *   OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://your-api.com/v1 MODEL=your-model npx tsx examples/10-sub-agent.ts
 */

import { Agent, tool, subAgent, z } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 共享的 Provider —— 所有 Agent 使用同一个 LLM 服务
// ============================================================

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const model = process.env.MODEL || 'gpt-4o-mini';

// ============================================================
// 研究员的工具 —— 模拟知识库查询
// ============================================================

// 模拟知识库数据
const knowledgeBase: Record<string, string> = {
  'react': 'React 是 Meta 开发的前端 UI 框架，使用组件化和虚拟 DOM。最新版本支持 Server Components 和 Suspense。',
  'vue': 'Vue 是一个渐进式前端框架，以易学和灵活著称。Vue 3 引入了 Composition API 和更好的 TypeScript 支持。',
  'typescript': 'TypeScript 是 JavaScript 的超集，添加了静态类型系统。广泛用于大型项目，提供更好的开发体验和代码质量。',
  'agent': 'AI Agent 是能自主决策和执行任务的 AI 系统。核心循环：感知 -> 推理 -> 行动。常见模式有 ReAct、Plan-and-Execute。',
  'rag': 'RAG（检索增强生成）将外部知识检索与 LLM 生成结合，减少幻觉。核心流程：查询 -> 检索 -> 增强 -> 生成。',
  'mcp': 'MCP（Model Context Protocol）是 Anthropic 提出的 AI 工具协议标准，让 AI 模型能安全地访问外部工具和数据源。',
};

// 知识库查询工具
const lookupKB = tool(
  {
    name: 'lookup_knowledge',
    description: '从技术知识库中查找相关信息',
    parameters: z.object({
      topic: z.string().describe('要查找的技术主题，如 "react"、"typescript"'),
    }),
  },
  async ({ topic }) => {
    // 模糊匹配：检查 topic 是否包含某个关键词
    const matchedKey = Object.keys(knowledgeBase).find(
      (key) => topic.toLowerCase().includes(key),
    );
    if (matchedKey) {
      return `[知识库] ${matchedKey}: ${knowledgeBase[matchedKey]}`;
    }
    return `[知识库] 未找到关于 "${topic}" 的信息。已知主题: ${Object.keys(knowledgeBase).join('、')}`;
  },
);

// 对比分析工具 —— 研究员可以对比两个技术
const compareTech = tool(
  {
    name: 'compare_tech',
    description: '对比两个技术方案的优劣',
    parameters: z.object({
      techA: z.string().describe('技术方案 A'),
      techB: z.string().describe('技术方案 B'),
    }),
  },
  async ({ techA, techB }) => {
    // 简单模拟对比结果
    return [
      `技术对比: ${techA} vs ${techB}`,
      ``,
      `${techA}:`,
      `  优势: 社区活跃，生态丰富，文档完善`,
      `  劣势: 学习曲线较陡，包体积较大`,
      ``,
      `${techB}:`,
      `  优势: 上手简单，渐进式采用，轻量级`,
      `  劣势: 生态相对较小，企业级方案较少`,
      ``,
      `建议: 根据团队经验和项目规模选择。大型项目推荐 ${techA}，中小型项目推荐 ${techB}。`,
    ].join('\n');
  },
);

// ============================================================
// 编码员的工具 —— 模拟代码生成
// ============================================================

// 模拟代码模板库
const codeTemplates: Record<string, string> = {
  'api': `// REST API 路由示例
import express from 'express';

const router = express.Router();

router.get('/items', async (req, res) => {
  const items = await db.findAll();
  res.json({ data: items });
});

router.post('/items', async (req, res) => {
  const item = await db.create(req.body);
  res.status(201).json({ data: item });
});

export default router;`,

  'component': `// React 组件示例
import { useState, useEffect } from 'react';

interface Props {
  title: string;
}

export function DataList({ title }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItems().then(setItems).finally(() => setLoading(false));
  }, []);

  if (loading) return <div>加载中...</div>;

  return (
    <div>
      <h2>{title}</h2>
      <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}`,

  'test': `// 单元测试示例
import { describe, it, expect, vi } from 'vitest';
import { fetchData } from './service';

describe('fetchData', () => {
  it('should return data on success', async () => {
    const mockData = { id: 1, name: 'test' };
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockData)),
    );

    const result = await fetchData('/api/items/1');
    expect(result).toEqual(mockData);
  });

  it('should throw on network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    await expect(fetchData('/api/items/1')).rejects.toThrow('Network error');
  });
});`,
};

// 代码生成工具
const generateCode = tool(
  {
    name: 'generate_code',
    description: '根据需求生成代码片段',
    parameters: z.object({
      requirement: z.string().describe('代码需求描述'),
      codeType: z
        .enum(['api', 'component', 'test'])
        .describe('代码类型: api(后端接口), component(前端组件), test(单元测试)'),
    }),
  },
  async ({ requirement, codeType }) => {
    const template = codeTemplates[codeType];
    if (!template) {
      return { content: `不支持的代码类型: ${codeType}`, isError: true };
    }
    return [
      `根据需求 "${requirement}" 生成的 ${codeType} 代码:`,
      '',
      '```typescript',
      template,
      '```',
      '',
      '注意: 这是基于模板生成的代码，请根据实际需求调整。',
    ].join('\n');
  },
);

// 代码解释工具
const explainCode = tool(
  {
    name: 'explain_code',
    description: '解释代码片段的功能和实现思路',
    parameters: z.object({
      code: z.string().describe('要解释的代码'),
    }),
  },
  async ({ code }) => {
    const lines = code.split('\n').length;
    const hasAsync = code.includes('async') || code.includes('await');
    const hasTypes = code.includes('interface') || code.includes('type ');

    return [
      '代码分析:',
      `  总行数: ${lines}`,
      `  使用异步: ${hasAsync ? '是' : '否'}`,
      `  有类型定义: ${hasTypes ? '是' : '否'}`,
      '',
      '这段代码的核心逻辑已就绪，建议进一步完善错误处理和边界检查。',
    ].join('\n');
  },
);

// ============================================================
// 创建子 Agent —— 用 subAgent() 包装为工具
// ============================================================

// 研究员子 Agent —— 配备知识库查询和对比分析工具
const researcher = subAgent({
  name: 'research',
  description: '技术研究员：负责调研技术方案、查阅知识库、对比分析。给它一个研究任务，它会返回详细的调研报告。',
  provider,
  model,
  tools: [lookupKB, compareTech],
  systemPrompt: '你是一个技术研究员。使用知识库工具查找信息，必要时进行技术对比。输出结构化的研究报告。用中文回答。',
  maxIterations: 8, // 子 Agent 迭代次数限制更保守
});

// 编码员子 Agent —— 配备代码生成和解释工具
const coder = subAgent({
  name: 'write_code',
  description: '编码员：负责根据需求编写代码。给它具体的编码任务，它会返回可运行的代码片段和说明。',
  provider,
  model,
  tools: [generateCode, explainCode],
  systemPrompt: '你是一个 TypeScript 编码专家。根据需求生成高质量代码，并解释实现思路。用中文回答。',
  maxIterations: 8,
});

// ============================================================
// 项目经理 Agent —— 用子 Agent 作为工具
// ============================================================

// 项目经理：拥有两个子 Agent 作为工具
// 父 Agent 的 LLM 会自行判断何时调用哪个子 Agent
const manager = new Agent({
  provider,
  model,
  tools: [researcher, coder],
  systemPrompt: `你是一个项目经理。当用户提出需求时，你负责:
1. 分析需求，拆解为研究和编码两类子任务
2. 将研究任务委派给 research（技术研究员）
3. 将编码任务委派给 write_code（编码员）
4. 汇总所有子 Agent 的结果，给用户一个完整的回复

注意：先让研究员调研清楚技术选型，再让编码员动手写代码。
用中文回答。`,
});

// ============================================================
// 主流程
// ============================================================

async function main() {
  const query =
    process.argv[2] ||
    '我想做一个简单的待办事项 Web 应用，请先调研一下适合的前端技术方案，然后帮我生成一个组件的代码';

  console.log('='.repeat(60));
  console.log('  多 Agent 协作演示');
  console.log('  项目经理 -> 研究员 + 编码员');
  console.log('='.repeat(60));
  console.log();
  console.log('Agent 架构:');
  console.log('  [项目经理] (主 Agent)');
  console.log('    |-- [研究员] (子 Agent: 知识库查询 + 技术对比)');
  console.log('    |-- [编码员] (子 Agent: 代码生成 + 代码解释)');
  console.log();
  console.log(`用户: ${query}`);
  console.log();

  for await (const event of manager.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`经理: ${event.content}`);
        break;

      case 'tool_request':
        // 当经理调用子 Agent 时，toolName 就是子 Agent 的 name
        console.log();
        console.log(`  [委派任务] -> ${event.toolName}`);
        console.log(`  [任务内容] ${JSON.stringify(event.args)}`);
        break;

      case 'tool_response':
        // 子 Agent 完成任务后的返回结果
        // 截取前 300 字符展示，避免输出过长
        const preview = event.content.length > 300
          ? event.content.slice(0, 300) + '...'
          : event.content;
        console.log(`  [${event.toolName} 结果] ${preview}`);
        console.log();
        break;

      case 'usage':
        // 注意：这里只统计了经理 Agent 本身的 token 用量
        // 子 Agent 的 token 用量不在此事件中（它们在子 Agent 内部消费）
        console.log(
          `  [经理 Token 用量] 输入=${event.usage.inputTokens} 输出=${event.usage.outputTokens}`,
        );
        break;

      case 'error':
        console.error(`  [错误] ${event.message}`);
        break;

      case 'agent_end':
        console.log(`\n经理 Agent 结束 (${event.reason})`);
        break;
    }
  }
}

main().catch(console.error);
