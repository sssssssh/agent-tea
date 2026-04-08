# @agent-tea/provider-anthropic

Agent-Tea 的 Anthropic Claude 适配器。

## 安装

```bash
pnpm add @agent-tea/provider-anthropic @agent-tea/sdk
```

## 快速上手

```typescript
import { Agent, tool, z } from '@agent-tea/sdk';
import { AnthropicProvider } from '@agent-tea/provider-anthropic';

const provider = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Agent({
    provider,
    model: 'claude-sonnet-4-20250514',
    tools: [
        /* ... */
    ],
});

for await (const event of agent.run('你好')) {
    if (event.type === 'message') console.log(event.content);
}
```

## 核心 API 概览

### AnthropicProvider

实现 `LLMProvider` 接口，创建基于 Anthropic SDK 的 ChatSession：

```typescript
const provider = new AnthropicProvider(options?: AnthropicProviderOptions);
const session = provider.chat({ model, tools, systemPrompt, temperature, maxTokens });
```

Provider ID: `'anthropic'`

### 适配器函数

将框架类型转换为 Anthropic 格式，高级场景下可直接使用：

```typescript
import { toAnthropicMessages, toAnthropicTools } from '@agent-tea/provider-anthropic';

const anthropicMessages = toAnthropicMessages(messages);
const anthropicTools = toAnthropicTools(toolDefinitions);
```

### Anthropic API 特性

该适配器自动处理 Anthropic API 的特殊要求：

- **系统提示词**：作为独立 API 参数传递（非消息数组）
- **消息交替**：严格的 user/assistant 交替规则
- **工具结果**：放在 user 消息的 `tool_result` content block 中
- **max_tokens**：必填参数（默认 4096）
- **工具定义**：使用 `input_schema` 而非 `parameters`

## 配置选项

### AnthropicProviderOptions

| 选项      | 类型     | 默认值                       | 说明     |
| --------- | -------- | ---------------------------- | -------- |
| `apiKey`  | `string` | `ANTHROPIC_API_KEY` 环境变量 | API 密钥 |
| `baseURL` | `string` | Anthropic 官方地址           | API 地址 |

### 环境变量

| 变量                | 说明                       |
| ------------------- | -------------------------- |
| `ANTHROPIC_API_KEY` | 未传入 `apiKey` 时自动读取 |

### 支持的模型参数

通过 `AgentConfig` 传递：

| 参数          | 说明                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `model`       | 模型 ID（如 `'claude-sonnet-4-20250514'`、`'claude-haiku-4-5-20251001'`） |
| `temperature` | 温度参数                                                                  |
| `maxTokens`   | 单次响应最大 token（默认 4096）                                           |

## 要求

- Node.js >= 20.0.0

## License

MIT
