# 5. Provider 适配层

## 类比：翻译官

框架的 Core 层说"普通话"（统一的 Message、Event 类型），但 OpenAI 说"英语"、Anthropic 说"法语"、Gemini 说"日语"。Provider 就是翻译官：

- **发送时**：把框架的 Message 翻译成各厂商的格式
- **接收时**：把各厂商的流式响应翻译回框架的 ChatStreamEvent

有了翻译官，Core 层永远不需要知道你用的是哪个 LLM。

## 两层设计：Provider + ChatSession

```
                          ┌───────────────────────┐
                          │  LLMProvider（翻译社）  │
                          │  持有 API 客户端        │
                          │  无状态，只是工厂       │
                          └────────┬──────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
              │ Session A  │ │ Session B  │ │ Session C  │
              │ gpt-4o     │ │ gpt-4o-mini│ │ gpt-4o     │
              │ 主 Agent   │ │ SubAgent   │ │ 另一个对话  │
              │ 工具集 A   │ │ 工具集 B   │ │ 无工具     │
              └───────────┘ └───────────┘ └───────────┘
```

**为什么不直接一个函数 `callLLM(model, messages, tools)` 搞定？**

因为 Session 封装了**不变的配置**。一个对话中，模型、系统提示词、可用工具通常是固定的，只有 messages 在变。把固定配置绑定在 Session 上，每次 `sendMessage()` 只需要传 messages，更简洁也更安全（不会中途意外换了模型）。

## 接口定义

```typescript
interface LLMProvider {
    readonly id: string; // 'openai' | 'anthropic' | 'gemini'
    chat(options: ChatOptions): ChatSession; // 创建会话
}

interface ChatSession {
    sendMessage(messages: Message[], signal?: AbortSignal): AsyncGenerator<ChatStreamEvent>; // 流式响应
}

interface ChatOptions {
    model: string; // 模型名
    systemPrompt?: string; // 系统提示词
    tools?: ToolDefinition[]; // 工具的 JSON Schema
    temperature?: number;
    maxTokens?: number;
}
```

接口很小 — 一个 Provider 只需要实现 `chat()` 方法，一个 Session 只需要实现 `sendMessage()` 方法。这是刻意的：接口越小，实现一个新 Provider 的门槛越低。

## 每个 Provider 做什么？

每个 Provider 包含三个部分：

```
provider-xxx/
├── provider.ts     # LLMProvider 实现 + ChatSession 实现
└── adapter.ts      # 消息/工具格式转换函数
```

### provider.ts 的职责

1. 构造函数：初始化 SDK 客户端（API Key、baseURL）
2. `chat()` 方法：返回 ChatSession 实例
3. ChatSession 的 `sendMessage()`：
    - 调用 adapter 把框架 Message → 厂商格式
    - 发起流式 API 请求
    - 逐 chunk 解析，翻译为 ChatStreamEvent yield 出去

### adapter.ts 的职责

两个纯函数，无副作用：

```typescript
toXxxMessages(messages: Message[]): VendorMessage[]    // 消息格式转换
toXxxTools(tools: ToolDefinition[]): VendorTool[]      // 工具格式转换
```

## 三家差异详解

### 差异 1：系统提示词的位置

```
OpenAI:     放在 messages 数组里，role = 'system'
Anthropic:  单独的顶级参数 system: "..."
Gemini:     config.systemInstruction
```

看起来只是位置不同，但意味着 adapter 的处理逻辑不同。OpenAI 的 adapter 需要在消息数组开头插入一条系统消息，Anthropic 和 Gemini 的 adapter 则不碰消息数组。

### 差异 2：工具调用参数的格式

```
OpenAI:     args 是 JSON 字符串  → '{"city":"北京"}'
Anthropic:  args 是对象          → { city: "北京" }
Gemini:     args 是对象          → { city: "北京" }
```

OpenAI 的工具调用参数是**序列化的字符串**，需要 `JSON.parse()` 才能用。Anthropic 和 Gemini 直接给对象。这个差异被 Provider 内部消化掉了 — 框架的 `ToolCallStreamEvent` 统一用对象格式。

### 差异 3：工具结果的放置

这是最大的差异：

```
OpenAI:
  messages: [
    { role: "assistant", content: ..., tool_calls: [...] },
    { role: "tool", tool_call_id: "abc", content: "结果" },     ← 独立的 tool 角色
    { role: "tool", tool_call_id: "def", content: "结果" },     ← 每个结果一条消息
  ]

Anthropic:
  messages: [
    { role: "assistant", content: [{ type: "tool_use", ... }] },
    { role: "user", content: [                                   ← 放在 user 角色里！
      { type: "tool_result", tool_use_id: "abc", content: "结果" },
      { type: "tool_result", tool_use_id: "def", content: "结果" },
    ]},
  ]

Gemini:
  contents: [
    { role: "model", parts: [{ functionCall: { ... } }] },
    { role: "user", parts: [                                     ← 也放在 user 里
      { functionResponse: { name: "xxx", response: { result: "结果" } } },
    ]},
  ]
```

**为什么 Anthropic/Gemini 把工具结果放在 user 消息里？**

因为它们要求严格的 user/assistant 交替。工具结果不是 AI 说的（不能是 assistant），也不能凭空出现，所以只能归入 user。这是 API 设计哲学的差异。

### 差异 4：流式传输的颗粒度

这是实现复杂度差异最大的地方：

**OpenAI — 碎片化**

```
chunk 1: { tool_calls: [{ index: 0, function: { name: "calc" } }] }
chunk 2: { tool_calls: [{ index: 0, function: { arguments: '{"x":' } }] }
chunk 3: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }
```

工具调用参数是**分散在多个 chunk 里的字符串碎片**。Provider 需要：

1. 用 Map 按 `index` 累积每个工具的参数字符串
2. 在 finish 时 `JSON.parse()` 拼接后的完整字符串
3. 处理 parse 失败的情况（降级为 `{ _raw: "原始字符串" }`）

**Anthropic — 块生命周期**

```
content_block_start: { type: "tool_use", id: "abc", name: "calc" }
content_block_delta: { partial_json: '{"x":' }
content_block_delta: { partial_json: '1}' }
content_block_stop
```

比 OpenAI 清晰 — 每个工具有明确的开始/增量/结束信号。Provider 按 `blockIndex` 跟踪每个块的生命周期。

**Gemini — 完整到达**

```
chunk: { functionCall: { name: "calc", args: { x: 1 } } }
```

最简单 — 工具调用整个到达，不需要拼接。但 Gemini 有另一个问题：它可能不返回工具调用 ID，Provider 需要用 `crypto.randomUUID()` 生成兜底 ID。

### 差异总览

| 维度         | OpenAI         | Anthropic               | Gemini      |
| ------------ | -------------- | ----------------------- | ----------- |
| 系统提示词   | messages 内    | 顶级参数                | config 属性 |
| 工具参数     | JSON 字符串    | 对象                    | 对象        |
| 工具结果角色 | tool           | user                    | user        |
| 流式颗粒度   | 碎片拼接       | 块生命周期              | 完整到达    |
| max_tokens   | 可选           | **必填**                | 可选        |
| API Key      | 自动读环境变量 | 自动读环境变量          | 需手动传入  |
| 消息交替     | 灵活           | **严格 user/assistant** | 灵活        |

## 如何添加新 Provider？

假设要接入一个新的 LLM，比如 Mistral：

```typescript
// 1. 实现 adapter（纯函数）
function toMistralMessages(messages: Message[]): MistralMessage[] { ... }
function toMistralTools(tools: ToolDefinition[]): MistralTool[] { ... }

// 2. 实现 Provider
class MistralProvider implements LLMProvider {
  readonly id = 'mistral';
  private client: MistralClient;

  constructor(options: { apiKey: string }) {
    this.client = new MistralClient(options.apiKey);
  }

  chat(options: ChatOptions): ChatSession {
    return new MistralChatSession(this.client, options);
  }
}

// 3. 实现 ChatSession（核心：流式处理）
class MistralChatSession implements ChatSession {
  async *sendMessage(messages, signal) {
    const vendorMessages = toMistralMessages(messages);
    const vendorTools = toMistralTools(this.tools);

    const stream = this.client.chatStream({
      model: this.model,
      messages: vendorMessages,
      tools: vendorTools,
    });

    for await (const chunk of stream) {
      // 把 Mistral 的 chunk 翻译成框架的 ChatStreamEvent
      if (chunk.choices[0].delta.content) {
        yield { type: 'text', text: chunk.choices[0].delta.content };
      }
      // ... 处理工具调用和结束事件
    }
  }
}
```

**工作量估算**：adapter 约 100 行，Provider + Session 约 150 行。框架的接口足够小，让实现新 Provider 变得可控。

---

下一篇：[事件流](./06-event-stream.md)
