# Bug 修复 + 高风险模块测试覆盖

日期：2026-04-10

## 目标

修复代码审查中发现的 11 个 bug，并为出过 bug 的模块和最高风险无测试模块补充测试，将覆盖率从 ~20% 提升到 ~50%。

## Phase 1：Bug 修复（11 个）

### Provider 层（4 个）

**P1. Gemini Provider 缺少 finish 事件**

- 文件：`packages/provider-gemini/src/provider.ts:115-126`
- 问题：finish 事件在 `if (chunk.usageMetadata)` 内部，若最终 chunk 无 usageMetadata 则不 yield finish
- 修复：将 finish yield 移到 for-await 循环之后，始终 yield，usageMetadata 有则带上

**P2. Anthropic Provider 丢失 inputTokens**

- 文件：`packages/provider-anthropic/src/provider.ts:148-170`
- 问题：message_start 中的 input_tokens 未捕获，finish 事件只有 outputTokens
- 修复：在函数顶部声明 `inputTokens` 变量，message_start 时赋值，message_delta 时合并到 finish usage

**P3. Anthropic/Gemini Adapter 静默丢弃空 assistant 消息**

- 文件：`packages/provider-anthropic/src/adapter.ts:59-61`、`packages/provider-gemini/src/adapter.ts:60-62`
- 问题：`if (blocks.length > 0)` 导致空 content 的 assistant 消息被跳过
- 修复：始终 push assistant 消息，与 OpenAI adapter 行为一致

**P4. Gemini Adapter functionResponse.name 为空**

- 文件：`packages/provider-gemini/src/adapter.ts:70`
- 问题：`name: ''` 假设 SDK 自动匹配，不保证
- 修复：adapter 函数接收原始 messages，从 assistant 消息的 tool_call content 中提取对应 toolName，按 toolCallId 匹配

### TUI 层（3 个）

**T1. useAgentEvents 中 collector.start() 无错误处理**

- 文件：`packages/tui/src/hooks/use-agent-events.ts:65`
- 修复：添加 `.catch()` 处理，将错误通过 snapshot 的 error 状态暴露

**T2. AgentTUI useEffect 依赖数组不完整**

- 文件：`packages/tui/src/runner/AgentTUI.tsx:75-88`
- 修复：补全 useEffect 依赖数组

**T3. History 用数组 index 做 React key**

- 文件：`packages/tui/src/components/History.tsx:16-46`
- 修复：为 HistoryItem 添加 `id` 字段（在 EventCollector 生成时分配递增 ID），History 组件用 `item.id` 做 key

### Core 层（4 个）

**C1. collectResponse() 重试时原地修改 retryOptions**

- 文件：`packages/core/src/agent/base-agent.ts:316-327`
- 修复：在 onRetry 回调中不修改原对象，改为返回新的 retry config 或在 retryWithBackoff 开头复制一份

**C2. execute-shell.ts 不安全的双重类型断言**

- 文件：`packages/core/src/tools/builtin/execute-shell.ts:41`
- 修复：安全提取 exit code：先检查 `error.status`（exec 的标准字段），再回退 `error.code`，最后默认 1

**C3. PlanAndExecute 计划解析无结构验证**

- 文件：`packages/core/src/agent/plan-and-execute-agent.ts:588`
- 修复：当 steps.length === 0 时，尝试按句号/换行分拆内容；若仍只有 1 步且过长（>500 字符），记录警告

**C4. MessageCompressor 空壳实现应标记清楚**

- 文件：`packages/core/src/context/processors/message-compressor.ts`
- 修复：在 JSDoc 中明确标注 `@experimental`，process() 中添加 console.warn 提示尚未实现

## Phase 2：出过 Bug 的模块补测试（~7 个文件）

| 测试文件                                | 覆盖模块             | 关键测试场景                                                  |
| --------------------------------------- | -------------------- | ------------------------------------------------------------- |
| provider-gemini/src/provider.test.ts    | Gemini Provider      | finish 事件始终 yield、有/无 usageMetadata、tool_call id 生成 |
| provider-gemini/src/adapter.test.ts     | Gemini Adapter       | 空 assistant 消息保留、functionResponse name 正确提取         |
| provider-anthropic/src/provider.test.ts | Anthropic Provider   | inputTokens + outputTokens 合并、message_start/delta 序列     |
| provider-anthropic/src/adapter.test.ts  | Anthropic Adapter    | 空 assistant 消息保留、tool_result 格式                       |
| tui/src/hooks/use-agent-events.test.ts  | useAgentEvents       | 多轮对话消息累积、collector.start 错误处理、initialQuery      |
| tui/src/hooks/use-approval.test.ts      | useApproval          | approve/reject 调用 agent.resolveApproval                     |
| core/src/agent/base-agent-retry.test.ts | collectResponse 重试 | retryOptions 不被修改、不同 phase 的重试策略                  |

## Phase 3：最高风险无测试模块补测试（~8 个文件）

| 测试文件                                                  | 覆盖模块               | 关键测试场景                                   |
| --------------------------------------------------------- | ---------------------- | ---------------------------------------------- |
| core/src/scheduler/scheduler.test.ts                      | Scheduler              | 并行执行、sequential 标签串行、混合分组        |
| core/src/tools/registry.test.ts                           | ToolRegistry           | 注册/获取/列举、Zod→JSON Schema 转换、重名处理 |
| core/src/tools/executor.test.ts                           | ToolExecutor           | Zod 验证失败、超时、正常执行、错误包装         |
| core/src/context/pipeline.test.ts                         | PipelineContextManager | 多处理器串联、空处理器、budget 传递            |
| core/src/context/processors/sliding-window.test.ts        | SlidingWindowProcessor | 超预算裁剪、保留消息、截断标记                 |
| core/src/context/processors/tool-output-truncator.test.ts | ToolOutputTruncator    | 超长工具输出截断、正常输出不变                 |
| core/src/tools/builtin/execute-shell.test.ts              | execute_shell          | 正常执行、超时、exit code 提取、输出截断       |
| core/src/tools/builtin/web-fetch.test.ts                  | web_fetch              | HTML 清理、超时、错误处理                      |

## 不在本次范围

- Memory stores（FileConversationStore/FileMemoryStore）— 文件 I/O 重，风险较低
- Loop detection — 已有测试
- State machine — 已有测试
- 性能优化（ContentTracker 内存限制、FileMemoryStore 全量读写）
- 错误消息中英文统一
