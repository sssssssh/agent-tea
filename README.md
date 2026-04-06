# Agent-Tea

TypeScript AI Agent 框架，实现 ReAct（推理 + 行动）模式。厂商无关的 Agent 循环，编排 LLM ↔ Tool 交互，流式优先、类型安全。

## 特性

- **ReAct Agent** — 经典推理-行动循环，LLM 思考 → 调用工具 → 观察结果 → 循环
- **Plan-and-Execute Agent** — 三阶段工作流：规划（只读工具）→ 人类审批 → 逐步执行
- **厂商无关** — 统一接口适配 OpenAI、Anthropic Claude、Google Gemini
- **流式优先** — 基于 AsyncGenerator 的事件流，支持实时 UI
- **类型安全** — Zod schema 驱动工具参数的类型推断和运行时验证
- **审批系统** — 基于标签的工具调用审批，敏感操作前等待人类确认
- **上下文管理** — 滑动窗口自动裁剪，防止消息超出 LLM 上下文窗口
- **记忆持久化** — 会话级对话存储 + 知识级跨会话记忆
- **多 Agent 协作** — SubAgent 将 Agent 包装为 Tool，实现层级化委派

## 架构

```
SDK 层     Extension / Skill / SubAgent    开发者 API
Core 层    Agent 循环 / 工具系统 / 事件流     框架核心
Provider   OpenAI / Anthropic / Gemini      LLM 适配
```

详细架构文档见 [docs/](docs/README.md)（8 篇专题，从概念到实现逐层深入）。

## 快速开始

### 安装

```bash
pnpm install
```

### 定义工具 + 启动 Agent

```typescript
import { Agent, tool } from '@agent-tea/sdk';
import { OpenAIProvider } from '@agent-tea/provider-openai';
import { z } from 'zod';

// 定义工具
const calculator = tool(
  {
    name: 'calculator',
    description: '计算数学表达式',
    parameters: z.object({
      expression: z.string().describe('数学表达式，如 "2 + 3 * 4"'),
    }),
  },
  async ({ expression }) => {
    return { content: String(eval(expression)) };
  }
);

// 创建 Agent
const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const agent = new Agent({
  provider,
  model: 'gpt-4o',
  tools: [calculator],
  systemPrompt: '你是一个有用的助手。',
});

// 运行并消费事件流
for await (const event of agent.run('123 * 456 等于多少？')) {
  switch (event.type) {
    case 'message':
      console.log(event.content);
      break;
    case 'tool_request':
      console.log(`调用工具: ${event.toolName}`);
      break;
  }
}
```

## 常用命令

```bash
pnpm build              # 构建所有包
pnpm test               # 运行测试
pnpm test:watch         # 监听模式
pnpm typecheck          # 类型检查

# 运行示例（需要 .env 配置 API Key）
pnpm example            # 基础 Agent
pnpm example:subagent   # 多 Agent 协作
pnpm example:approval   # 审批 + 记忆
```

## 包结构

| 包 | 说明 |
|---|------|
| `@agent-tea/core` | 框架核心 — Agent 循环、工具系统、事件流、状态机 |
| `@agent-tea/sdk` | 开发者 API — Extension、Skill、SubAgent 抽象 |
| `@agent-tea/provider-openai` | OpenAI / 兼容 API 适配器 |
| `@agent-tea/provider-anthropic` | Anthropic Claude 适配器 |
| `@agent-tea/provider-gemini` | Google Gemini 适配器 |

## 要求

- Node.js >= 20.0.0
- pnpm

## License

MIT
