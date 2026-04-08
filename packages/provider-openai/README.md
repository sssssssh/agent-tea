# @agent-tea/provider-openai

Agent-Tea 的 OpenAI 适配器 — 支持 OpenAI API 及兼容服务（Azure OpenAI、本地模型等）。

## 安装

```bash
pnpm add @agent-tea/provider-openai @agent-tea/sdk
```

## 快速上手

```typescript
import { Agent, tool, z } from '@agent-tea/sdk';
import { OpenAIProvider } from '@agent-tea/provider-openai';

const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
});

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

### 使用兼容 API

通过 `baseURL` 接入 OpenAI 兼容服务（Azure、Ollama、vLLM 等）：

```typescript
const provider = new OpenAIProvider({
    apiKey: process.env.API_KEY,
    baseURL: 'https://your-endpoint.com/v1',
    defaultHeaders: {
        'x-custom-header': 'value',
    },
});
```

## 核心 API 概览

### OpenAIProvider

实现 `LLMProvider` 接口，创建基于 OpenAI SDK 的 ChatSession：

```typescript
const provider = new OpenAIProvider(options?: OpenAIProviderOptions);
const session = provider.chat({ model, tools, systemPrompt, temperature, maxTokens });
```

Provider ID: `'openai'`

### 适配器函数

将框架类型转换为 OpenAI 格式，高级场景下可直接使用：

```typescript
import { toOpenAIMessages, toOpenAITools } from '@agent-tea/provider-openai';

const openaiMessages = toOpenAIMessages(messages);
const openaiTools = toOpenAITools(toolDefinitions);
```

## 配置选项

### OpenAIProviderOptions

| 选项             | 类型                     | 默认值                    | 说明                     |
| ---------------- | ------------------------ | ------------------------- | ------------------------ |
| `apiKey`         | `string`                 | `OPENAI_API_KEY` 环境变量 | API 密钥                 |
| `baseURL`        | `string`                 | OpenAI 官方地址           | API 地址（用于兼容服务） |
| `defaultHeaders` | `Record<string, string>` | —                         | 默认请求头               |

### 环境变量

| 变量             | 说明                       |
| ---------------- | -------------------------- |
| `OPENAI_API_KEY` | 未传入 `apiKey` 时自动读取 |

### 支持的模型参数

通过 `AgentConfig` 传递：

| 参数          | 说明                                      |
| ------------- | ----------------------------------------- |
| `model`       | 模型 ID（如 `'gpt-4o'`、`'gpt-4o-mini'`） |
| `temperature` | 温度参数                                  |
| `maxTokens`   | 单次响应最大 token                        |

## 要求

- Node.js >= 20.0.0

## License

MIT
