# @agent-tea/core

Agent-Tea 框架核心 — 提供 Agent 循环、工具系统、事件流、状态机、上下文管理等基础设施。

> 大多数开发者应直接使用 [`@agent-tea/sdk`](../sdk/)，它重新导出了 core 的全部公共 API 并提供更高层的抽象。

## 安装

```bash
pnpm add @agent-tea/core
```

## 快速上手

```typescript
import { Agent, tool, ToolRegistry } from '@agent-tea/core';
import { z } from 'zod';

// 1. 定义工具
const greet = tool(
    {
        name: 'greet',
        description: '向用户打招呼',
        parameters: z.object({ name: z.string() }),
    },
    async ({ name }) => `你好，${name}！`,
);

// 2. 创建 Agent（需要一个 LLMProvider 实现）
const agent = new Agent({
    provider: myProvider,
    model: 'gpt-4o',
    tools: [greet],
    systemPrompt: '你是一个友好的助手。',
});

// 3. 运行并消费事件流
for await (const event of agent.run('跟张三打个招呼')) {
    if (event.type === 'message') console.log(event.content);
}
```

## 核心 API 概览

### Agent 类

提供两种策略的 Agent 实现：

| 类 | 说明 |
|---|------|
| `Agent` / `ReActAgent` | 经典 ReAct 循环：思考 → 工具调用 → 观察 → 循环，直到纯文本回复或达到 maxIterations |
| `PlanAndExecuteAgent` | 三阶段：规划（仅只读工具）→ 审批 → 逐步执行，支持失败恢复 |

```typescript
// ReAct（默认）
const agent = new Agent({ provider, model, tools });

// Plan-and-Execute
const agent = new PlanAndExecuteAgent({ provider, model, tools });
```

`agent.run(input)` 返回 `AsyncGenerator<AgentEvent>`，支持实时 UI 渲染。

### 工具系统

用 `tool()` 工厂函数创建类型安全的工具，Zod schema 同时驱动类型推断和运行时验证：

```typescript
const search = tool(
    {
        name: 'search',
        description: '搜索文件内容',
        parameters: z.object({
            pattern: z.string().describe('搜索模式'),
            path: z.string().optional().describe('搜索路径'),
        }),
        tags: ['readonly'],   // 用于审批策略和工具过滤
        timeout: 10000,       // 工具级超时（ms）
    },
    async ({ pattern, path }, context) => {
        // context: { sessionId, cwd, messages, signal }
        return { content: '搜索结果...' };
    },
);
```

工具永不抛异常 — 所有错误包装为 `ToolResult`（`isError: true`），让 LLM 可以调整策略。

**内置工具**：`readFile`、`writeFile`、`listDirectory`、`executeShell`、`grep`、`webFetch`。

### 事件流

`agent.run()` 产出的事件类型（可辨识联合，按 `type` 字段匹配）：

| 事件类型 | 说明 |
|---------|------|
| `agent_start` / `agent_end` | Agent 生命周期 |
| `message` | LLM 文本输出 |
| `tool_request` / `tool_response` | 工具调用请求和结果 |
| `usage` | Token 用量统计 |
| `error` | 错误事件 |
| `state_change` | 状态机转换 |
| `approval_request` | 审批请求（等待用户确认） |
| `plan_created` / `step_start` / `step_complete` / `step_failed` / `execution_paused` | 计划执行相关 |

### LLMProvider 接口

Provider 是工厂模式 — 创建 `ChatSession` 实例：

```typescript
interface LLMProvider {
    readonly id: string;
    chat(options: ChatOptions): ChatSession;
}

interface ChatSession {
    sendMessage(
        messages: Message[],
        signal?: AbortSignal,
    ): AsyncGenerator<ChatStreamEvent>;
}
```

官方适配器：`@agent-tea/provider-openai`、`@agent-tea/provider-anthropic`、`@agent-tea/provider-gemini`。

### 上下文管理

Token 感知的消息裁剪，防止超出模型上下文窗口：

```typescript
import { createContextManager } from '@agent-tea/core';

const agent = new Agent({
    provider,
    model: 'gpt-4o',
    contextManager: createContextManager({
        strategy: 'pipeline',
        maxTokens: 120000,
        reservedTokens: 4000,
        processors: ['sliding_window', 'tool_output_truncator'],
    }),
});
```

两种策略：
- **`sliding_window`** — 保留系统消息 + 最新消息，中间截断
- **`pipeline`** — 管道式组合多个处理器（`SlidingWindowProcessor`、`ToolOutputTruncator`、`MessageCompressor`）

### 记忆持久化

两个独立存储层，均为可选：

```typescript
import { FileConversationStore, FileMemoryStore } from '@agent-tea/core';

const agent = new Agent({
    provider,
    model: 'gpt-4o',
    // 会话级：保存/加载完整消息历史
    conversationStore: new FileConversationStore('.agent-tea/conversations'),
    // 知识级：带标签的键值条目，跨会话共享
    memoryStore: new FileMemoryStore('.agent-tea/memory'),
});
```

### 审批系统

基于标签的工具调用审批，敏感操作前等待用户确认：

```typescript
const agent = new Agent({
    provider,
    model: 'gpt-4o',
    tools: [readTool, writeTool],
    approvalPolicy: {
        mode: 'tagged',
        tags: ['write', 'irreversible'],
    },
});

for await (const event of agent.run(input)) {
    if (event.type === 'approval_request') {
        // 审查工具调用，决定批准/拒绝/修改参数
        agent.resolveApproval(event.requestId, {
            approved: true,
            // modifiedArgs: { ... }  // 可选：修改参数后批准
        });
    }
}
```

### 钩子系统

无需子类化即可定制 Agent 行为：

| 钩子 | 触发时机 |
|------|---------|
| `onBeforeIteration` / `onAfterIteration` | 每次迭代前/后 |
| `onToolFilter` | 动态过滤可用工具集 |
| `onBeforeToolCall` / `onAfterToolCall` | 工具执行前/后拦截 |
| `onPlanCreated` | 计划审批门 |
| `onStepStart` / `onStepComplete` / `onStepFailed` | 步骤级监控和错误恢复 |

### 错误层级

```
AgentTeaError
├── ProviderError          # LLM API 错误（含 statusCode, retryable 标志）
├── ToolExecutionError     # 工具执行失败
├── ToolValidationError    # 工具参数验证失败（含 validationErrors）
├── MaxIterationsError     # 达到最大迭代次数
├── LoopDetectedError      # 检测到 Agent 死循环
└── TimeoutError           # 超时（phase: 'tool' | 'llm_connection' | 'llm_stream'）
```

## 配置选项

`AgentConfig` 完整配置参考：

| 选项 | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `provider` | `LLMProvider` | **必填** | LLM Provider 实例 |
| `model` | `string` | **必填** | 模型 ID |
| `tools` | `Tool[]` | `[]` | 可用工具列表 |
| `systemPrompt` | `string` | — | 系统提示词 |
| `maxIterations` | `number` | `500` | 最大迭代次数 |
| `temperature` | `number` | — | 温度参数 |
| `maxTokens` | `number` | — | 单次响应最大 token |
| `agentId` | `string` | 自动 UUID | Agent 标识 |
| `strategy` | `'react' \| 'plan-and-execute'` | `'react'` | Agent 策略 |
| `allowPlanMode` | `boolean` | — | 允许运行时切换计划模式 |
| `planStoreDir` | `string` | `'.agent-tea/plans'` | 计划持久化目录 |
| `approvalPolicy` | `ApprovalPolicy` | — | 审批策略（`'always'` / `'tagged'` / `'never'`） |
| `loopDetection` | `LoopDetectionConfig` | 已启用 | 循环检测配置 |
| `toolTimeout` | `number` | `30000` | 全局工具超时（ms） |
| `llmTimeout.connectionMs` | `number` | `60000` | LLM 首次响应超时 |
| `llmTimeout.streamStallMs` | `number` | `30000` | 流式响应停滞超时 |
| `contextManager` | `ContextManagerConfig` | — | 上下文管理器配置 |
| `conversationStore` | `ConversationStore` | — | 会话存储 |
| `memoryStore` | `MemoryStore` | — | 记忆存储 |

## 设计原则

- **Zod 唯一真相来源** — 同时驱动 TypeScript 类型推断和运行时参数验证
- **仅 ESM** — 输出 ES Module，目标 ES2022
- **流式优先** — 所有 LLM 通信使用 AsyncGenerator
- **工具永不抛异常** — 错误包装为 `ToolResult`，Agent 循环保持安全
- **可辨识联合** — Events、Messages、ContentParts 均使用 `type` 字段
- **可选子系统** — 审批、上下文管理、持久化默认关闭，不配置无行为变化

## 要求

- Node.js >= 20.0.0

## License

MIT
