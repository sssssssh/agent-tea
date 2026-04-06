# T-Agent Server — 设计方案

## 目标

基于 t-agent 框架构建中心化 Agent 服务平台，通过 HTTP API 让公司各团队（技术栈不统一）快速获得 AI 能力。

## 核心决策

| 决策点 | 结论 |
|--------|------|
| 产品形态 | 中心化 Agent 服务，NestJS 项目 |
| 接入方式 | HTTP API，语言无关 |
| 接入深度 | 即插即用（预置模板）+ 可配置（团队自定义 Agent） |
| 入口 | ① 同步 API（SSE 流式返回） ② Webhook 接收事件（异步处理） |
| 结果返回 | 同步直接返回 / 异步回调 Webhook |
| 工具来源 | 团队注册自己的业务 HTTP API，平台自动包装成 t-agent Tool |
| 代码访问 | 本地 clone 仓库 + 只读操作（读文件、搜索），无需沙盒 |
| 管控 | API Key + 按团队限流，初期基础管控 |
| 落地节奏 | 先跑通一个标杆案例（日志分析） |

## NestJS 模块划分（6 个模块）

### 1. agent/ — Agent 运行模块

- `POST /agents/:id/chat` — SSE 流式对话
- `POST /agents/:id/run` — 同步等结果
- 封装 t-agent 调用 + 会话上下文管理

### 2. webhook/ — 事件接收模块

- `POST /webhooks/:agentId` — 接收业务系统事件
- 异步调度 Agent 处理
- 完成后回调业务系统预配置的 URL

### 3. config/ — Agent 配置管理模块

- Agent 配置 CRUD（模型、提示词、工具组合）
- 支持预置模板和团队自定义

### 4. tool/ — 工具注册模块

- 团队注册 HTTP 工具（提供 URL + JSON Schema）
- 平台自动转为 t-agent Tool（HTTP Tool Bridge）

### 5. repo/ — 代码仓库模块

- 代码仓库 clone/pull
- 只读文件操作（read_file、search_code）

### 6. auth/ — 认证模块

- API Key 校验 Guard
- 按团队限流

## 项目结构

```
t-agent-server/
├── src/
│   ├── app.module.ts
│   ├── agent/
│   │   ├── agent.controller.ts
│   │   ├── agent.service.ts
│   │   └── agent.module.ts
│   ├── webhook/
│   │   ├── webhook.controller.ts
│   │   ├── webhook.service.ts
│   │   └── webhook.module.ts
│   ├── config/
│   │   ├── config.controller.ts
│   │   ├── config.service.ts
│   │   └── config.module.ts
│   ├── tool/
│   │   ├── tool.controller.ts
│   │   ├── tool.service.ts
│   │   └── tool.module.ts
│   ├── repo/
│   │   ├── repo.service.ts
│   │   └── repo.module.ts
│   └── auth/
│       ├── auth.guard.ts
│       └── auth.module.ts
├── package.json
└── nest-cli.json
```

## 与 CRUD 的关键差异

- **长时间请求**：Agent 一次调用可能几秒到几分钟（多轮 LLM + 工具调用循环），同步接口需 SSE 流式返回
- **异步任务**：Webhook 触发的任务需后台执行 + 结果回调
- **会话状态**：对话可跨多轮请求，需维护消息历史

## 标杆案例：日志分析

```
监控系统 → Webhook 推事件到平台
  → Agent 启动
  → 调用日志查询 HTTP 工具拿日志
  → clone/pull 代码仓库，搜索相关代码
  → LLM 综合分析
  → 回调 Webhook 返回诊断报告
```

## 依赖关系

```
t-agent-server (NestJS)
  ├── @t-agent/core       — Agent 引擎
  ├── @t-agent/sdk        — Extension/Skill/SubAgent
  ├── @t-agent/provider-* — LLM 适配器（按需选用）
  └── @nestjs/*             — HTTP 框架
```

## 核心总结

NestJS + t-agent，6 个模块，两种入口，先做日志分析标杆。
