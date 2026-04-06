# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指引。

## 项目概述

t-agent 是一个 TypeScript AI Agent 框架，实现 ReAct（推理 + 行动）模式。提供厂商无关的 Agent 循环，编排 LLM ↔ Tool 交互，流式优先、类型安全。

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm build                # 构建所有包 (tsup)
pnpm test                 # 运行全部测试 (vitest，单次)
pnpm test:watch           # 监听模式运行测试
pnpm typecheck            # 类型检查所有包 (tsc --noEmit)

# 运行单个测试文件
pnpm vitest run packages/core/src/agent/agent.test.ts

# 运行示例（需要 .env 配置 API Key）
pnpm example              # 基础 Agent 示例
pnpm example:subagent     # 多 Agent 示例
```

## 架构

### Monorepo 结构（pnpm workspaces）

```
packages/
  core/                 # 框架核心 — Agent 循环、工具系统、LLM 接口
  sdk/                  # 上层 API — Extension、Skill、SubAgent 抽象
  provider-openai/      # OpenAI 适配器
  provider-anthropic/   # Anthropic Claude 适配器
  provider-gemini/      # Google Gemini 适配器
examples/               # 使用示例
3th-agents/             # 第三方 Agent 实现参考（codex、gemini-cli）
docs/                   # 设计文档和实施计划
.t-agent/             # 运行时产物（会话、记忆、计划）— 已 gitignore
```

### 核心概念

**三层架构**：Core（框架）→ Provider（LLM 适配器）→ SDK（开发者 API）

**Provider + ChatSession 模式**：`LLMProvider` 是工厂，创建 `ChatSession` 实例。一个 provider 可创建多个不同配置的 session。每个 session 的 `sendMessage()` 返回 `AsyncGenerator<ChatStreamEvent>`。

**Agent 策略**（`packages/core/src/agent/`）：
- `BaseAgent` — 抽象基类，包含共享基础设施（session 创建、响应收集、工具执行、钩子）
- `ReActAgent` — 经典 ReAct 循环：发送→收集→执行工具→循环，直到纯文本响应或达到 maxIterations（默认 20）。支持可选的 `allowPlanMode` 动态注入计划模式工具。
- `PlanAndExecuteAgent` — 三阶段工作流：**规划**（仅只读工具，通过 `readonly` 标签过滤）→ **审批**（计划通过 `PlanStore` 持久化，`onPlanCreated` 钩子等待用户确认）→ **执行**（完整工具集，逐步执行，支持失败恢复钩子：暂停/跳过/重新规划/中止）

**状态机**（`packages/core/src/agent/state-machine.ts`）：强制合法的状态转换（如 ReAct：`idle→reacting→completed`，PlanAndExecute：`idle→planning→awaiting_approval→executing→completed`）。`awaiting_approval` 状态也用于审批系统等待用户确认工具调用。运行时阻止非法转换。

**工具系统**：工具用 Zod schema 定义参数。`ToolRegistry` 存储工具并将 Zod 转换为 JSON Schema 供 LLM 使用。`ToolExecutor` 在执行前用 Zod 验证输入。工具永不抛异常 — 所有错误都包装为 `ToolResult`（`isError: true`），让 LLM 可以调整策略。

**工具标签**：工具可以有 `tags`（如 `'readonly'`）。Agent 按阶段用标签过滤可用工具 — PlanAndExecuteAgent 在规划阶段通过 `onToolFilter()` 仅允许 readonly 标签的工具。

**内置工具**（`packages/core/src/tools/internal/`）：如 `enter_plan_mode` 和 `exit_plan_mode`，在 ReActAgent 设置 `allowPlanMode` 时动态启用计划模式切换。

**PlanStore**（`packages/core/src/agent/plan-store.ts`）：基于文件的计划持久化（JSON）。保存到 `planStoreDir`（默认 `.t-agent/plans/`），跟踪步骤状态，支持恢复和审计。

**审批系统**（`packages/core/src/approval/`）：工具调用审批/拒绝工作流。通过 `AgentConfig` 中的 `ApprovalPolicy` 控制，三种模式：`'always'`（所有工具）、`'tagged'`（仅指定标签的工具，推荐）、`'never'`（默认）。复用现有 `Tool.tags` 标记。在 `executeToolCalls()` 中，Agent 产出 `approval_request` 事件并等待 `resolveApproval()` 调用 — 非阻塞异步模式，适用于 CLI/UI。`ApprovalDecision` 支持 `modifiedArgs` 在执行前修改参数。

**上下文管理**（`packages/core/src/context/`）：Token 感知的消息裁剪。`ContextManager` 接口，`prepare(messages): Message[]` 方法。默认 `SlidingWindowContextManager` 用 `字符数/4` 估算 token，保留前 N 条保留消息 + 最新消息，中间插入截断标记。在 `collectResponse()` 中每次 LLM 调用前自动应用。通过 `AgentConfig` 中的 `contextManager: { maxTokens, strategy?, reservedMessageCount? }` 配置。

**记忆/持久化**（`packages/core/src/memory/`）：两个独立存储层，均为可选：
- `ConversationStore` — 会话级：保存/加载/列举/删除完整消息历史。`FileConversationStore` 以 JSON 存储在 `.t-agent/conversations/`。
- `MemoryStore` — 知识级：带标签的键值条目，用于跨会话知识。`FileMemoryStore` 存储在 `.t-agent/memory/`，通过 index.json 支持快速标签搜索。

**钩子系统**：BaseAgent 暴露扩展点，无需子类化即可定制行为：
- `onBeforeIteration` / `onAfterIteration` — 迭代生命周期
- `onToolFilter` — 按 Agent 状态动态过滤工具集
- `onBeforeToolCall` / `onAfterToolCall` — 工具执行拦截
- `onPlanCreated` — 计划审批门（PlanAndExecuteAgent）
- `onStepStart` / `onStepComplete` / `onStepFailed` — 步骤级监控和错误恢复

**事件流**：`Agent.run()` 通过 AsyncGenerator 产出 `AgentEvent` — 支持实时 UI 而不阻塞。事件类型：`agent_start`、`agent_end`、`message`、`tool_request`、`tool_response`、`usage`、`error`、`state_change`、`approval_request`，以及计划相关：`plan_created`、`step_start`、`step_complete`、`step_failed`、`execution_paused`。

**SDK 抽象**（`packages/sdk/`）：
- `Extension` — 可复用能力包（打包工具 + 指令）
- `Skill` — 任务特定的提示词 + 工具，带触发条件
- `SubAgent` — 将 ReActAgent 包装为 Tool；父 Agent 通过工具调用发起，收集 assistant 消息作为结果。支持层级化多 Agent 协作。

### 核心数据流

```
Agent.run(input)
├─ yield agent_start
├─ executeLoop()
│  ├─ createChatSession()，应用 onToolFilter
│  └─ 循环：
│     ├─ contextManager.prepare(messages) → 超预算则裁剪
│     ├─ collectResponse() → LLM 流式响应 → { text, toolCalls, usage }
│     ├─ yield message / usage 事件
│     ├─ 无工具调用？→ 完成
│     └─ executeToolCalls()
│        ├─ 需要审批？→ yield approval_request，等待 resolveApproval()
│        ├─ onBeforeToolCall 钩子
│        ├─ Scheduler → ToolExecutor（Zod 验证 + 执行）
│        ├─ yield tool_request / tool_response
│        └─ 将结果追加到消息，继续循环
├─ conversationStore.save()（如已配置）
└─ yield agent_end
```

### 关键设计决策

- **Zod 作为唯一真相来源**：Zod schema 同时驱动 TypeScript 类型推断和运行时参数验证。
- **仅 ESM**：所有包输出 ESM（`format: ['esm']`），目标 ES2022。
- **流式优先**：所有 LLM 通信使用 async generator；无阻塞式请求/响应。
- **错误层级**：`AgentTeaError` → `ProviderError` / `ToolExecutionError` / `ToolValidationError` / `MaxIterationsError`。`ProviderError` 包含 `retryable` 标志，供 `retryWithBackoff()` 使用。
- **可辨识联合**：Events、Messages、ContentParts 均使用 `type` 字段，支持安全的模式匹配和 TypeScript 穷举检查。
- **工具永不抛异常**：ToolExecutor 将所有失败包装为 `ToolResult` — Agent 循环保持安全，LLM 看到错误后可调整策略。
- **可选子系统**：审批、上下文管理、持久化默认关闭，不配置则无行为变化 — 完全向后兼容。

## 约定

- 源代码注释使用中文；代码标识符和 API 使用英文。
- 需要 Node.js >= 20.0.0。
- 每个包用 `tsup` 构建，用 `tsc --noEmit` 类型检查。
- 测试使用 Vitest，`globals: true`。测试模式：用预编排的响应序列 mock LLM provider。
- Provider 适配器遵循统一模式：实现 `LLMProvider` 接口 + 厂商特定的消息/工具格式适配器（`toXxxMessages()`、`toXxxTools()`）。
