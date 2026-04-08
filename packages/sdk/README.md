# @agent-tea/sdk

Agent-Tea 统一开发者入口 — 重新导出 core 全部 API，并提供 Extension、Skill、SubAgent、自动发现等高层抽象。

> **推荐入口**：大多数项目只需安装 `@agent-tea/sdk` + 一个 Provider 包即可。

## 安装

```bash
pnpm add @agent-tea/sdk
# 按需安装 Provider
pnpm add @agent-tea/provider-openai
```

## 快速上手

```typescript
import { Agent, tool, extension, skill, subAgent, discover, z } from '@agent-tea/sdk';
import { OpenAIProvider } from '@agent-tea/provider-openai';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

// 创建 Agent 并运行
const agent = new Agent({
    provider,
    model: 'gpt-4o',
    tools: [
        /* ... */
    ],
});

for await (const event of agent.run('你好')) {
    if (event.type === 'message') console.log(event.content);
}
```

## 核心 API 概览

### Extension — 可复用能力包

将工具、技能和指令打包为可复用的领域模块：

```typescript
import { extension, tool, z } from '@agent-tea/sdk';

const codeTools = extension({
    name: 'code-tools',
    description: '代码读写工具集',
    instructions: '用 grep 搜索、read_file 查看详情…',
    tools: [readFileTool, grepTool, writeFileTool],
    skills: [reviewSkill],
});

// 使用：展开到 Agent 配置
const agent = new Agent({
    provider,
    model: 'gpt-4o',
    tools: [...codeTools.tools],
    systemPrompt: codeTools.instructions,
});
```

**内置 Extension**：`builtinTools` 打包了 6 个内置工具（readFile、writeFile、listDirectory、executeShell、grep、webFetch）。

```typescript
import { builtinTools } from '@agent-tea/sdk';

const agent = new Agent({
    provider,
    model: 'gpt-4o',
    tools: builtinTools.tools,
    systemPrompt: builtinTools.instructions,
});
```

### Skill — 任务特定的提示词 + 工具

封装特定任务模式，带触发条件：

```typescript
import { skill } from '@agent-tea/sdk';

const reviewSkill = skill({
    name: 'code-review',
    description: '代码审查',
    instructions: '仔细检查代码质量、安全性和性能…',
    tools: [readFileTool, grepTool],
    trigger: '/review', // 可选：命令式触发
});
```

### SubAgent — 多 Agent 协作

将 Agent 包装为 Tool，实现层级化委派：

```typescript
import { subAgent } from '@agent-tea/sdk';

const researcher = subAgent({
    name: 'researcher',
    description: '深度调研助手，擅长信息搜集和整理',
    provider,
    model: 'gpt-4o-mini',
    tools: [webFetchTool, grepTool],
    systemPrompt: '你是一个调研助手…',
    maxIterations: 10, // 默认 10
});

// 作为工具传给父 Agent
const agent = new Agent({
    provider,
    model: 'gpt-4o',
    tools: [researcher, writeTool],
});
```

父 Agent 通过工具调用发起子任务，子 Agent 的 assistant 消息作为工具结果返回。

### discover() — 文件系统自动发现

自动扫描 `~/.agent-tea/`（全局）和 `.agent-tea/`（项目级）目录，加载 SKILL.md 和 AGENT.md：

```typescript
import { discover } from '@agent-tea/sdk';

const { skills, agents, tools, instructions } = await discover({
    provider,
    model: 'gpt-4o',
    projectDir: process.cwd(), // 默认
    globalDir: '~/.agent-tea', // 默认
    extraTools: myToolMap, // 可选：自定义工具注册表
});

const agent = new Agent({
    provider,
    model: 'gpt-4o',
    tools: [...tools, ...myTools],
    systemPrompt: `基础提示词\n\n${instructions}`,
});
```

**SKILL.md 格式**（兼容 Claude Code）：

```yaml
---
name: code-review
description: 代码审查技能
version: 1.0.0
trigger: /review
tools: [read_file, grep]
---
# 审查指南

检查以下方面：
- 代码质量和可读性
- 安全漏洞
- 性能问题
```

**AGENT.md 格式**：

```yaml
---
name: researcher
description: 调研助手
model: gpt-4o-mini
maxIterations: 10
tools: [web_fetch, grep]
---
你是一个调研助手，擅长信息搜集和整理。
```

项目级同名资产覆盖全局。

### 重新导出的 Core API

SDK 重新导出 `@agent-tea/core` 的全部公共 API，包括：

- **Agent**：`Agent`、`ReActAgent`、`PlanAndExecuteAgent`
- **工具**：`tool()`、`ToolRegistry`、内置工具
- **事件**：所有 `AgentEvent` 类型
- **上下文管理**：`createContextManager()`、处理器
- **记忆**：`FileConversationStore`、`FileMemoryStore`
- **审批**：`requiresApproval()`
- **循环检测**：`LoopDetector`
- **错误**：完整错误层级
- **工具函数**：`retryWithBackoff()`
- **Zod**：重新导出 `z`，方便定义工具参数

## 配置选项

### Extension

| 字段           | 类型      | 必填 | 说明                 |
| -------------- | --------- | ---- | -------------------- |
| `name`         | `string`  | 是   | Extension 名称       |
| `description`  | `string`  | 否   | 描述                 |
| `instructions` | `string`  | 否   | 注入系统提示词的指令 |
| `tools`        | `Tool[]`  | 否   | 打包的工具           |
| `skills`       | `Skill[]` | 否   | 打包的技能           |

### Skill

| 字段           | 类型     | 必填 | 说明                     |
| -------------- | -------- | ---- | ------------------------ |
| `name`         | `string` | 是   | Skill 名称               |
| `description`  | `string` | 是   | 描述（LLM 可见）         |
| `instructions` | `string` | 是   | 注入系统提示词的指令     |
| `tools`        | `Tool[]` | 否   | 关联的工具               |
| `trigger`      | `string` | 否   | 触发命令（如 `/review`） |

### SubAgent

| 字段            | 类型          | 必填 | 说明                        |
| --------------- | ------------- | ---- | --------------------------- |
| `name`          | `string`      | 是   | 子 Agent 名称（也是工具名） |
| `description`   | `string`      | 是   | 描述（父 Agent 可见）       |
| `provider`      | `LLMProvider` | 是   | LLM Provider                |
| `model`         | `string`      | 是   | 模型 ID                     |
| `tools`         | `Tool[]`      | 否   | 子 Agent 可用工具           |
| `systemPrompt`  | `string`      | 否   | 系统提示词                  |
| `maxIterations` | `number`      | 否   | 最大迭代次数（默认 10）     |

### discover()

| 字段         | 类型                | 必填 | 说明                            |
| ------------ | ------------------- | ---- | ------------------------------- |
| `provider`   | `LLMProvider`       | 是   | 用于子 Agent 的 Provider        |
| `model`      | `string`            | 是   | 默认模型                        |
| `projectDir` | `string`            | 否   | 项目目录（默认 `cwd()`）        |
| `globalDir`  | `string`            | 否   | 全局目录（默认 `~/.agent-tea`） |
| `extraTools` | `Map<string, Tool>` | 否   | 自定义工具注册表                |

## 要求

- Node.js >= 20.0.0

## License

MIT
