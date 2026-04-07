# Agent-Tea 框架文档

## 阅读顺序

| 顺序 | 文档                                   | 内容                                              | 适合谁                    |
| ---- | -------------------------------------- | ------------------------------------------------- | ------------------------- |
| 1    | [框架全貌](./01-overview.md)           | 用类比解释核心概念，理解框架在做什么              | 所有人                    |
| 2    | [核心循环](./02-core-loop.md)          | 用一个具体例子走完 Agent 从启动到结束的全流程     | 所有人                    |
| 3    | [Agent 策略](./03-agent-strategies.md) | ReAct vs Plan-and-Execute，两种思考方式的对比     | 想理解 Agent 行为差异的人 |
| 4    | [工具系统](./04-tool-system.md)        | 工具如何定义、注册、验证、执行                    | 想给 Agent 加能力的人     |
| 5    | [Provider 适配层](./05-providers.md)   | 如何屏蔽 OpenAI / Anthropic / Gemini 的差异       | 想接入新 LLM 的人         |
| 6    | [事件流](./06-event-stream.md)         | Agent 运行时的实时事件，如何构建 UI               | 想做前端/集成的人         |
| 7    | [可选子系统](./07-subsystems.md)       | 审批、上下文管理、记忆持久化、循环检测、超时      | 想做生产级应用的人        |
| 8    | [SDK 与多 Agent](./08-sdk.md)          | Extension / Skill / SubAgent / Discovery 高层抽象 | 想构建复杂 Agent 系统的人 |
| 9    | [终端 UI](./09-tui.md)                | EventCollector / React Hooks / Ink 组件 / AgentTUI | 想构建终端交互界面的人    |

## 一句话概括

> agent-tea 是一个 **Agent 循环引擎**：你告诉它"用哪个 LLM"和"有哪些工具"，它负责让 LLM 反复思考和调用工具，直到任务完成。整个过程以事件流的形式实时输出，你可以在任意环节插入审批、裁剪上下文、持久化记忆、超时保护。支持从文件系统自动发现 Skill 和 Agent，也支持用 TUI 组件库在终端中构建实时交互界面。
