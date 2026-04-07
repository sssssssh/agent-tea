# @agent-tea/provider-gemini

Agent-Tea 的 Google Gemini 适配器。

## 安装

```bash
pnpm add @agent-tea/provider-gemini @agent-tea/sdk
```

## 快速上手

```typescript
import { Agent, tool, z } from '@agent-tea/sdk';
import { GeminiProvider } from '@agent-tea/provider-gemini';

const provider = new GeminiProvider({
    apiKey: process.env.GEMINI_API_KEY,
});

const agent = new Agent({
    provider,
    model: 'gemini-2.0-flash',
    tools: [/* ... */],
});

for await (const event of agent.run('你好')) {
    if (event.type === 'message') console.log(event.content);
}
```

## 核心 API 概览

### GeminiProvider

实现 `LLMProvider` 接口，创建基于 Google GenAI SDK 的 ChatSession：

```typescript
const provider = new GeminiProvider(options: GeminiProviderOptions);
const session = provider.chat({ model, tools, systemPrompt, temperature, maxTokens });
```

Provider ID: `'gemini'`

### 适配器函数

将框架类型转换为 Gemini 格式，高级场景下可直接使用：

```typescript
import { toGeminiContents, toGeminiTools } from '@agent-tea/provider-gemini';

const geminiContents = toGeminiContents(messages);
const geminiTools = toGeminiTools(toolDefinitions);
```

### Gemini API 特性

该适配器自动处理 Gemini API 的特殊要求：

- **角色映射**：简化为 `'user'` / `'model'`（无 system/tool/assistant 角色区分）
- **系统提示词**：通过 `config.systemInstruction` 传递
- **工具调用**：在单个 chunk 中完整返回（无需跨 chunk 拼接）
- **工具定义**：所有函数声明包装在单个 Tool 对象的 `functionDeclarations` 数组中
- **工具结果**：以 `functionResponse` part 放在 user Content 中

## 配置选项

### GeminiProviderOptions

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiKey` | `string` | `GEMINI_API_KEY` 环境变量 | API 密钥（**必填**，环境变量或参数二选一） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `GEMINI_API_KEY` | 未传入 `apiKey` 时自动读取 |

### 支持的模型参数

通过 `AgentConfig` 传递：

| 参数 | 说明 |
|------|------|
| `model` | 模型 ID（如 `'gemini-2.0-flash'`、`'gemini-2.5-pro'`） |
| `temperature` | 温度参数 |
| `maxTokens` | 单次响应最大 token（映射为 `maxOutputTokens`） |

## 要求

- Node.js >= 20.0.0

## License

MIT
