# Agent-Tea

TypeScript AI Agent 框架，实现 ReAct（推理 + 行动）模式。厂商无关的 Agent 循环，编排 LLM ↔ Tool 交互，流式优先、类型安全。

## 特性

- **ReAct Agent** — 经典推理-行动循环，LLM 思考 → 调用工具 → 观察结果 → 循环
- **Plan-and-Execute Agent** — 三阶段工作流：规划（只读工具）→ 人类审批 → 逐步执行
- **厂商无关** — 统一接口适配 OpenAI、Anthropic Claude、Google Gemini
- **流式优先** — 基于 AsyncGenerator 的事件流，支持实时 UI
- **类型安全** — Zod schema 驱动工具参数的类型推断和运行时验证
- **内置工具** — 开箱即用的 6 个实用工具：文件读写、目录列表、Shell 执行、代码搜索、网页抓取
- **并行调度** — 工具默认并行执行，`sequential` 标签标记需要顺序执行的工具
- **审批系统** — 基于标签的工具调用审批，敏感操作前等待人类确认
- **上下文管理** — 滑动窗口 + Pipeline 管道两种策略，自动裁剪消息防止超出上下文窗口
- **循环检测** — 自动识别重复工具调用和内容重复，先警告后中止，防止 Agent 死循环
- **记忆持久化** — 会话级对话存储 + 知识级跨会话记忆
- **错误恢复** — 工具永不抛异常 + 指数退避重试 + 结构化错误层级
- **多 Agent 协作** — SubAgent 将 Agent 包装为 Tool，实现层级化委派
- **终端 UI** — 基于 Ink 的 TUI 框架，开箱即用的 Agent 交互界面，组件可替换、布局可定制

## 架构

```
TUI 层     AgentTUI / Components / Hooks    终端交互
SDK 层     Extension / Skill / SubAgent     开发者 API
Core 层    Agent 循环 / 工具系统 / 事件流     框架核心
Provider   OpenAI / Anthropic / Gemini      LLM 适配
```

详细架构文档见 [docs/](docs/README.md)。

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
    },
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
pnpm example:01         # 最小 Agent — 自定义工具 + 事件消费
pnpm example:02         # 内置工具 — readFile/grep/listDirectory 等
pnpm example:03         # 完整事件流 — 所有 AgentEvent 类型
pnpm example:04         # 钩子系统 — 生命周期拦截
pnpm example:05         # 多 Provider — OpenAI/Anthropic/Gemini 切换
pnpm example:06         # 上下文管理 — Pipeline + Processor
pnpm example:07         # 审批系统 — 工具标签 + 交互确认
pnpm example:08         # 记忆持久化 — 会话存储 + 知识库
pnpm example:09         # Extension & Skill — 能力打包
pnpm example:10         # SubAgent — 多 Agent 协作
pnpm example:11         # PlanAndExecute — 规划-审批-执行
pnpm example:12         # 循环检测 — LoopDetector
pnpm example:13         # 错误恢复 — 重试/迭代上限/工具异常
pnpm example:14         # 知识问答 — 综合：内置工具+记忆+审批
pnpm example:15         # 研发助手 — 全功能综合
pnpm example:16         # 自动发现 — 文件系统 Skill/Agent 加载
pnpm example:17         # EventCollector — 事件流聚合为状态快照
pnpm example:18         # 批量运行 — 多 Agent 并行
pnpm example:19         # SDK SubAgent — 带事件收集的子 Agent
pnpm example:20         # TUI 最小示例 — 一行启动终端 UI
pnpm example:21         # TUI 自定义组件 — 替换默认 UI 组件
pnpm example:22         # TUI 自定义布局 — 完全控制界面排版
pnpm example:23         # TUI Plan-Execute — 终端中的规划-执行流
```

## 包结构

| 包                              | 说明                                            |
| ------------------------------- | ----------------------------------------------- |
| `@agent-tea/core`               | 框架核心 — Agent 循环、工具系统、事件流、状态机 |
| `@agent-tea/sdk`                | 开发者 API — Extension、Skill、SubAgent 抽象    |
| `@agent-tea/tui`                | 终端 UI — 基于 Ink 的 Agent 交互界面            |
| `@agent-tea/provider-openai`    | OpenAI / 兼容 API 适配器                        |
| `@agent-tea/provider-anthropic` | Anthropic Claude 适配器                         |
| `@agent-tea/provider-gemini`    | Google Gemini 适配器                            |

## 要求

- Node.js >= 20.0.0
- pnpm

## License

MIT
