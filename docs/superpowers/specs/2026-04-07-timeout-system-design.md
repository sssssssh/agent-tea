# 超时系统设计

## 概述

为 agent-tea 框架增加三层超时保护：TimeoutError 类型、工具执行超时、LLM 请求超时（连接/流中分阶段）。

## 1. TimeoutError 类型

在 `packages/core/src/errors/errors.ts` 新增：

```typescript
export class TimeoutError extends AgentTeaError {
    constructor(
        message: string,
        public readonly timeoutMs: number,
        public readonly phase: 'tool' | 'llm_connection' | 'llm_stream',
    ) {
        super(message);
        this.name = 'TimeoutError';
    }
}
```

- `phase` 区分三种来源，调用层可据此决定不同的重试策略
- 从 `index.ts` 导出

## 2. 工具执行超时

### Tool 接口扩展

`packages/core/src/tools/types.ts` 的 `Tool` 接口增加可选字段：

```typescript
readonly timeout?: number;
```

### AgentConfig 扩展

`packages/core/src/config/types.ts` 增加：

```typescript
toolTimeout?: number;
```

默认 30000ms。设为 0 或 Infinity 表示不限制。

### ToolExecutor 改动

`packages/core/src/scheduler/executor.ts`：

- 新增 `globalTimeout` 参数
- 超时优先级：`tool.timeout > globalTimeout > DEFAULT_TOOL_TIMEOUT (30s)`
- 用 `Promise.race` 实现：超时时先 abort signal 通知工具优雅退出，然后 reject `TimeoutError`
- 捕获 `TimeoutError` 后转为 `ToolResult(isError: true)`，错误信息包含超时毫秒数

辅助函数 `createToolTimeoutRace(timeoutMs, toolName, abortController)` 放在 executor.ts 中：

- 返回一个 Promise，超时后调用 `abortController.abort()` 再 reject
- finally 中 clearTimeout 防止内存泄漏

### 传递链路

```
AgentConfig.toolTimeout → BaseAgent → executeToolCalls() → Scheduler → ToolExecutor
```

Scheduler 的 `execute()` 和 `executeSingle()` 方法签名加 `globalTimeout?: number` 参数，透传给 ToolExecutor。

## 3. LLM 请求超时

### AgentConfig 扩展

```typescript
llmTimeout?: {
  connectionMs?: number;   // 连接超时，默认 60000
  streamStallMs?: number;  // 流停滞超时，默认 30000
};
```

### 两阶段超时定义

| 阶段     | 含义                         | 默认值 | 检测方式                       |
| -------- | ---------------------------- | ------ | ------------------------------ |
| 连接阶段 | 发送请求到收到第一个有效事件 | 60s    | setTimeout，收到首个事件后清除 |
| 流中阶段 | 两个连续事件之间的最大间隔   | 30s    | 每收到一个事件重置计时器       |

### collectResponse() 改动

`packages/core/src/agent/base-agent.ts` 的 `collectResponse()` 方法：

```
原来：直接 for await of chatSession.sendMessage()
改后：包装一个 withStreamTimeout() 的 async generator
```

新增 `withStreamTimeout(stream, config)` 辅助函数（放在 `packages/core/src/utils/stream-timeout.ts`）：

```typescript
async function* withStreamTimeout<T>(
    stream: AsyncGenerator<T>,
    config: { connectionMs: number; streamStallMs: number },
    signal: AbortSignal,
): AsyncGenerator<T> {
    let firstEventReceived = false;
    let timer: NodeJS.Timeout;

    const resetTimer = (phase: 'connection' | 'stream') => {
        clearTimeout(timer);
        const ms = phase === 'connection' ? config.connectionMs : config.streamStallMs;
        timer = setTimeout(() => {
            // abort signal 通知 provider 停止
            // 但不直接 reject，而是让 for-await-of 自然结束后由调用方检测
        }, ms);
    };

    try {
        resetTimer('connection');
        for await (const event of stream) {
            if (!firstEventReceived) {
                firstEventReceived = true;
            }
            clearTimeout(timer);
            yield event;
            resetTimer('stream');
        }
    } finally {
        clearTimeout(timer);
    }
}
```

实际实现使用 AbortController：超时时 abort，for-await-of 被中断后抛出 TimeoutError（通过 abort reason 传递）。

### 重试策略

在 `collectResponse()` 中，捕获 `TimeoutError` 后根据 phase 使用不同的重试配置：

| phase            | 重试次数 | 初始延迟 | 最大延迟 |
| ---------------- | -------- | -------- | -------- |
| `llm_connection` | 3        | 5s       | 30s      |
| `llm_stream`     | 2        | 1s       | 5s       |

重试时复用现有的 `retryWithBackoff`，但用不同的配置。外部传入的 AbortSignal 仍然优先 — 用户取消时立即停止重试。

### 与现有机制的交互

- `collectResponse` 当前遇到 `error` 事件时 `throw event.error`。超时机制与此正交 — 如果 provider 自己报了错，走现有逻辑；如果 provider 卡住不报错，走超时逻辑。
- 现有的 `maxIterations` 限制不变 — 超时是时间维度的保护，迭代次数是次数维度的保护，两者互补。

## 4. 影响范围

### 需要修改的文件

| 文件                                       | 改动                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| `packages/core/src/errors/errors.ts`       | 新增 TimeoutError                                           |
| `packages/core/src/tools/types.ts`         | Tool 接口加 timeout 字段                                    |
| `packages/core/src/config/types.ts`        | AgentConfig 加 toolTimeout、llmTimeout                      |
| `packages/core/src/scheduler/executor.ts`  | 加超时竞速逻辑                                              |
| `packages/core/src/scheduler/scheduler.ts` | 透传 globalTimeout                                          |
| `packages/core/src/agent/base-agent.ts`    | collectResponse 加流超时，executeToolCalls 透传 toolTimeout |
| `packages/core/src/index.ts`               | 导出 TimeoutError                                           |

### 需要新增的文件

| 文件                                        | 内容                       |
| ------------------------------------------- | -------------------------- |
| `packages/core/src/utils/stream-timeout.ts` | withStreamTimeout 辅助函数 |

### 需要新增/修改的测试

| 文件                                             | 内容                                        |
| ------------------------------------------------ | ------------------------------------------- |
| `packages/core/src/scheduler/executor.test.ts`   | 工具超时测试                                |
| `packages/core/src/utils/stream-timeout.test.ts` | 流超时测试                                  |
| `packages/core/src/agent/react-agent.test.ts`    | 集成测试：超时后重试、超时后 Agent 正常结束 |

## 5. 向后兼容

- 所有新配置均可选，不设置时行为与改动前完全一致
- 唯一隐性变化：ToolExecutor 增加了默认 30s 超时。如果现有工具执行超过 30s 会受影响。但这是合理的安全默认值 — 用户可通过 `toolTimeout: Infinity` 关闭
- Tool 接口只加了可选字段，现有工具定义无需修改
