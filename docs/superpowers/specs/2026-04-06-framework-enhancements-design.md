# agent-tea 框架增强设计：并行执行、上下文压缩、内置工具、循环检测

> 日期：2026-04-06
> 状态：已批准，待实施

## 背景

对比 gemini-cli，agent-tea 在四个方面存在明显缺口：工具只能串行执行、上下文管理过于粗暴、缺少开箱即用的基础工具、循环检测仅靠 maxIterations 硬截断。本设计解决这四个问题。

## 设计决策总结

| 特性 | 方案 |
|------|------|
| 并行工具执行 | 默认并行，按 `sequential` 标签 opt-out，审批时降级顺序 |
| 上下文压缩 | 可组合的 ContextProcessor 管道 |
| 内置工具集 | 4 类 6 个工具，通过 Extension 打包 |
| 循环检测 | 工具调用重复 + 内容重复，注入提示后仍循环才终止 |

---

## 模块一：并行工具执行

### 问题

`Scheduler.execute()` 用 `for` 循环逐个 `await`，所有工具串行。多个只读工具（如同时读 3 个文件）本可并行，但被迫等待。

### 设计

#### 标签约定

- 无 `sequential` 标签的工具默认可并行
- 带 `sequential` 标签的工具强制顺序执行（如 `write_file`、`execute_shell`）

#### 分组逻辑

将一批工具调用分成 **执行组**：连续的可并行工具归为一组（并行执行），遇到 `sequential` 工具则单独一组（顺序执行）。

```
输入: [read_a, read_b, write_c, read_d, read_e]

Group 1 (parallel):   [read_a, read_b]
Group 2 (sequential): [write_c]
Group 3 (parallel):   [read_d, read_e]

执行: Group 1 内部 Promise.all() → Group 2 → Group 3 内部 Promise.all()
```

#### Scheduler 改造

```typescript
interface ExecutionGroup {
  requests: ToolCallRequest[];
  parallel: boolean;
}

class Scheduler {
  private groupRequests(requests: ToolCallRequest[]): ExecutionGroup[] {
    const groups: ExecutionGroup[] = [];
    let currentGroup: ToolCallRequest[] = [];
    let currentParallel = true;

    for (const req of requests) {
      const isSequential = this.isSequential(req);
      if (isSequential) {
        // 先 flush 当前并行组
        if (currentGroup.length > 0) {
          groups.push({ requests: currentGroup, parallel: currentParallel });
          currentGroup = [];
        }
        groups.push({ requests: [req], parallel: false });
        currentParallel = true;
      } else {
        currentGroup.push(req);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({ requests: currentGroup, parallel: true });
    }
    return groups;
  }

  private isSequential(req: ToolCallRequest): boolean {
    const tool = this.registry.get(req.name);
    return tool?.tags?.includes('sequential') ?? false;
  }

  async *execute(requests, context): AsyncGenerator<ToolCallResult> {
    const groups = this.groupRequests(requests);
    for (const group of groups) {
      if (context.signal?.aborted) {
        for (const req of group.requests) {
          yield this.abortedResult(req);
        }
        continue;
      }
      if (group.parallel && group.requests.length > 1) {
        const results = await Promise.all(
          group.requests.map(req => this.executor.execute(req, context))
        );
        for (const result of results) yield result;
      } else {
        for (const req of group.requests) {
          if (context.signal?.aborted) {
            yield this.abortedResult(req);
            continue;
          }
          yield await this.executor.execute(req, context);
        }
      }
    }
  }
}
```

#### 审批兼容

在 `BaseAgent.executeToolCalls()` 中：若本批工具中任一工具需要审批（`requiresApproval` 返回 true），整批降级为逐个执行，保持现有审批流程不变。

#### Scheduler 构造函数变更

`Scheduler` 需要访问 `ToolRegistry` 来查询工具标签：

```typescript
class Scheduler {
  constructor(
    private executor: ToolExecutor,
    private registry: ToolRegistry,  // 新增
  ) {}
}
```

#### 事件流

并行组内：先 yield 所有 `tool_request` 事件，等待全部完成后按顺序 yield `tool_response` 事件。

### 影响范围

- `packages/core/src/scheduler/scheduler.ts` — 主要改动
- `packages/core/src/agent/base-agent.ts` — Scheduler 构造 + 审批降级逻辑
- `packages/core/src/scheduler/executor.ts` — 无改动

---

## 模块二：上下文压缩管道

### 问题

`SlidingWindowContextManager` 只做一件事：超限时删中间消息。无法对超长工具输出做针对性压缩，信息损失大。

### 设计

#### 核心概念

引入 `ContextProcessor`：一个处理步骤，接收消息列表，返回处理后的消息列表。多个 processor 组成管道依次执行。

先压缩大块内容（工具输出截断），再删旧消息（滑动窗口）。渐进式压缩，信息损失最小化。

#### ContextProcessor 接口

```typescript
interface ContextProcessor {
  name: string;
  process(messages: Message[], budget: TokenBudget): Message[];
}

interface TokenBudget {
  maxTokens: number;
  estimateTokens(messages: Message[]): number;
}
```

#### PipelineContextManager

```typescript
class PipelineContextManager implements ContextManager {
  constructor(
    private processors: ContextProcessor[],
    private config: { maxTokens: number },
  ) {}

  prepare(messages: Message[]): Message[] {
    const budget: TokenBudget = {
      maxTokens: this.config.maxTokens,
      estimateTokens: this.estimateTokens.bind(this),
    };
    let result = messages;
    for (const processor of this.processors) {
      result = processor.process(result, budget);
    }
    return result;
  }

  private estimateTokens(messages: Message[]): number {
    // char / 4 估算，复用现有逻辑
  }
}
```

#### 内置 Processor

**ToolOutputTruncator**（第 1 步：压缩大件）

遍历消息，将超长 `ToolResultPart` 内容截断为头部 + 尾部 + 截断标记。

```typescript
interface ToolOutputTruncatorConfig {
  maxOutputLength: number;   // 单个工具输出最大字符数，默认 10000
  headRatio: number;         // 保留头部比例，默认 0.3
  tailRatio: number;         // 保留尾部比例，默认 0.3
  protectedTurns: number;    // 最近 N 轮工具输出不截断，默认 2
}
```

处理逻辑：
1. 从消息尾部往前数 `protectedTurns` 轮，这些消息不动
2. 对其余消息中的 `ToolResultPart`，若 `content` 长度 > `maxOutputLength`：
   - 保留前 `maxOutputLength * headRatio` 字符
   - 保留后 `maxOutputLength * tailRatio` 字符
   - 中间替换为 `[... 已截断 X 字符 ...]`

**SlidingWindowProcessor**（第 2 步：删旧消息）

从现有 `SlidingWindowContextManager` 重构提取。逻辑不变：保留头部 reserved 消息 + 最新消息，超预算时丢弃中间消息并插入截断标记。

```typescript
interface SlidingWindowProcessorConfig {
  reservedMessageCount: number;  // 默认 1
}
```

**MessageCompressor**（可选第 3 步：LLM 摘要）

需要开发者提供摘要函数（框架不隐式调用 LLM）。

```typescript
interface MessageCompressorConfig {
  summarize: (messages: Message[]) => Promise<string>;
  triggerThreshold: number;   // 消息数超过此值才触发，默认 30
  protectedTurns: number;     // 最近 N 轮不压缩，默认 5
}
```

#### 向后兼容

`createContextManager` 工厂函数保持现有签名可用：

```typescript
// 旧用法，不变
createContextManager({ maxTokens: 100000, strategy: 'sliding_window' });
// 内部等价于：
new PipelineContextManager(
  [new SlidingWindowProcessor({ reservedMessageCount: 1 })],
  { maxTokens: 100000 },
);

// 新用法
createContextManager({
  maxTokens: 100000,
  strategy: 'pipeline',
  processors: [
    new ToolOutputTruncator({ maxOutputLength: 10000 }),
    new SlidingWindowProcessor({ reservedMessageCount: 1 }),
  ],
});
```

#### 文件组织

```
packages/core/src/context/
  types.ts                          // 新增 ContextProcessor, TokenBudget
  pipeline.ts                       // PipelineContextManager
  processors/
    sliding-window.ts               // 从现有 sliding-window.ts 重构
    tool-output-truncator.ts        // 新增
    message-compressor.ts           // 新增
  sliding-window.ts                 // 保留但标记 deprecated，内部委托给 pipeline
  index.ts                          // 导出
```

### 影响范围

- `packages/core/src/context/` — 主要改动区域
- `packages/core/src/agent/base-agent.ts` — 无改动（仍调用 `contextManager.prepare()`）
- `packages/core/src/config/types.ts` — `ContextManagerConfig` 扩展

---

## 模块三：内置工具集

### 问题

框架只有 2 个 internal 工具（plan mode 相关），开发者缺少开箱即用的基础能力。

### 设计

#### 工具清单

| 工具名 | 参数 | 标签 | 说明 |
|--------|------|------|------|
| `read_file` | `path`, `startLine?`, `endLine?` | `readonly` | 读取文件，支持行范围，带行号输出 |
| `write_file` | `path`, `content`, `createDirectories?` | `sequential` | 写入/覆盖文件 |
| `list_directory` | `path`, `recursive?`, `maxDepth?` | `readonly` | 列出目录内容，树形输出 |
| `execute_shell` | `command`, `cwd?`, `timeout?` | `sequential` | 执行 shell 命令，超时+输出截断 |
| `grep` | `pattern`, `path`, `include?`, `maxResults?` | `readonly` | 正则搜索文件内容 |
| `web_fetch` | `url`, `maxLength?` | `readonly` | 获取 URL 文本内容（仅 GET） |

#### 参数定义

**read_file**
```typescript
z.object({
  path: z.string().describe('文件路径（绝对或相对于 cwd）'),
  startLine: z.number().int().positive().optional().describe('起始行号（从 1 开始）'),
  endLine: z.number().int().positive().optional().describe('结束行号（含）'),
})
```
- 输出带行号前缀（`  1 | const x = 1`）
- 超过 2000 行自动截断并提示使用行范围参数
- 相对路径基于 `ToolContext.cwd` 解析

**write_file**
```typescript
z.object({
  path: z.string().describe('文件路径'),
  content: z.string().describe('写入内容'),
  createDirectories: z.boolean().optional().default(false)
    .describe('自动创建不存在的父目录'),
})
```
- 返回写入的字节数和路径确认

**list_directory**
```typescript
z.object({
  path: z.string().describe('目录路径'),
  recursive: z.boolean().optional().default(false),
  maxDepth: z.number().int().min(1).max(10).optional().default(3),
})
```
- 返回树形结构文本
- 限制最大条目数（默认 500）防止超大目录爆输出

**execute_shell**
```typescript
z.object({
  command: z.string().describe('要执行的 shell 命令'),
  cwd: z.string().optional().describe('工作目录'),
  timeout: z.number().optional().default(30000).describe('超时毫秒数'),
})
```
- 返回 `{ stdout, stderr, exitCode }`
- stdout/stderr 各自截断上限 50000 字符
- 超时自动 kill 子进程并返回错误

**grep**
```typescript
z.object({
  pattern: z.string().describe('正则表达式模式'),
  path: z.string().describe('搜索路径（文件或目录）'),
  include: z.string().optional().describe('文件名 glob 过滤，如 "*.ts"'),
  maxResults: z.number().optional().default(50).describe('最大返回匹配数'),
})
```
- 返回格式：`file:line: content`
- 递归搜索目录
- 跳过二进制文件和 node_modules

**web_fetch**
```typescript
z.object({
  url: z.string().url().describe('要获取的 URL'),
  maxLength: z.number().optional().default(50000).describe('最大返回字符数'),
})
```
- 仅支持 GET 请求
- 超时 10 秒
- 尝试提取纯文本（HTML 时去标签）
- 超长截断

#### 打包方式

工具定义放在 core 层（`packages/core/src/tools/builtin/`），通过 SDK 的 Extension 打包导出：

```typescript
// packages/sdk/src/extensions/builtin-tools.ts
import { Extension } from '../extension';
import { readFile, writeFile, listDirectory, executeShell, grep, webFetch }
  from '@agent-tea/core';

export const builtinTools = new Extension({
  name: 'builtin-tools',
  tools: [readFile, writeFile, listDirectory, executeShell, grep, webFetch],
  instructions: '你有文件读写、shell 执行、代码搜索和网页获取能力。'
    + '优先用 grep 搜索定位，再用 read_file 精读相关部分。'
    + '写文件前先读取确认当前内容。',
});

// 也单独导出每个工具，供开发者按需使用
export { readFile, writeFile, listDirectory, executeShell, grep, webFetch };
```

开发者使用：
```typescript
import { builtinTools } from '@agent-tea/sdk';

const agent = new Agent({
  provider,
  extensions: [builtinTools],  // 全部引入
});

// 或按需挑选
import { readFile, grep } from '@agent-tea/sdk';
const agent = new Agent({
  provider,
  tools: [readFile, grep],
});
```

#### 文件组织

```
packages/core/src/tools/
  builtin/
    read-file.ts
    write-file.ts
    list-directory.ts
    execute-shell.ts
    grep.ts
    web-fetch.ts
    index.ts
  internal/              # 不动
packages/sdk/src/
  extensions/
    builtin-tools.ts
```

### 影响范围

- `packages/core/src/tools/builtin/` — 全部新增
- `packages/sdk/src/extensions/` — 新增 builtin-tools.ts
- `packages/core/src/index.ts`、`packages/sdk/src/index.ts` — 导出

---

## 模块四：循环检测

### 问题

仅靠 `maxIterations` 硬截断。LLM 可能在第 5 轮就开始重复操作，但要等到第 20 轮才停，浪费 token。

### 设计

#### 两层检测

**第一层：工具调用重复**

连续 N 次调用相同工具 + 相同参数 → 触发。

```typescript
class ToolCallTracker {
  private lastHash: string | null = null;
  private consecutiveCount = 0;

  track(toolName: string, args: unknown): void {
    const hash = this.hash(toolName, args);
    if (hash === this.lastHash) {
      this.consecutiveCount++;
    } else {
      this.lastHash = hash;
      this.consecutiveCount = 1;
    }
  }

  isLooping(threshold: number): boolean {
    return this.consecutiveCount >= threshold;
  }

  // LLM 产出纯文本时重置（说明它在正常思考）
  reset(): void {
    this.lastHash = null;
    this.consecutiveCount = 0;
  }

  private hash(name: string, args: unknown): string {
    return `${name}:${JSON.stringify(args, Object.keys(args as object).sort())}`;
  }
}
```

**第二层：内容重复**

LLM 输出文本出现周期性重复 → 触发。

```typescript
class ContentTracker {
  private chunkSize = 50;
  private chunks: Map<string, number[]> = new Map(); // hash → 出现位置列表
  private position = 0;

  track(content: string): void {
    // 排除代码块
    const text = this.stripCodeBlocks(content);
    for (let i = 0; i <= text.length - this.chunkSize; i += this.chunkSize) {
      const chunk = text.slice(i, i + this.chunkSize);
      const hash = this.simpleHash(chunk);
      const positions = this.chunks.get(hash) || [];
      positions.push(this.position + i);
      this.chunks.set(hash, positions);
    }
    this.position += content.length;
  }

  isLooping(threshold: number): boolean {
    for (const [, positions] of this.chunks) {
      if (positions.length < threshold) continue;
      // 检查最近 threshold 次出现是否间距均匀（周期性重复）
      const recent = positions.slice(-threshold);
      const gaps = [];
      for (let i = 1; i < recent.length; i++) {
        gaps.push(recent[i] - recent[i - 1]);
      }
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const isUniform = gaps.every(g => Math.abs(g - avgGap) < avgGap * 0.3);
      if (isUniform && avgGap < this.chunkSize * 5) return true;
    }
    return false;
  }

  private stripCodeBlocks(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '');
  }

  private simpleHash(str: string): string {
    // 简单字符串 hash，不需要密码学强度
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  }
}
```

#### 整合：LoopDetector

```typescript
class LoopDetector {
  private toolTracker = new ToolCallTracker();
  private contentTracker = new ContentTracker();
  private warningCount = 0;

  constructor(private config: LoopDetectionConfig) {}

  trackToolCall(name: string, args: unknown): void {
    this.toolTracker.track(name, args);
  }

  trackContent(content: string): void {
    this.contentTracker.track(content);
    this.toolTracker.reset(); // 有文本输出说明在正常思考
  }

  check(): LoopCheckResult {
    const toolLoop = this.toolTracker.isLooping(this.config.maxConsecutiveIdenticalCalls);
    const contentLoop = this.contentTracker.isLooping(this.config.contentRepetitionThreshold);

    if (!toolLoop && !contentLoop) {
      return { looping: false };
    }

    this.warningCount++;
    const type = toolLoop ? 'tool_call' : 'content';

    if (this.warningCount > this.config.maxWarnings) {
      return { looping: true, type, action: 'abort' };
    }
    return { looping: true, type, action: 'warn' };
  }
}

interface LoopCheckResult {
  looping: boolean;
  type?: 'tool_call' | 'content';
  action?: 'warn' | 'abort';
}
```

#### 触发后行为

- `action: 'warn'`：向 messages 注入提示：
  `"你似乎在重复相同的操作且没有进展。请分析当前策略为什么失败，然后尝试完全不同的方法。如果任务无法完成，请直接告知用户。"`
- `action: 'abort'`：抛出 `LoopDetectedError`，终止 Agent

#### 配置

```typescript
interface LoopDetectionConfig {
  enabled: boolean;                      // 默认 true
  maxConsecutiveIdenticalCalls: number;  // 默认 3
  contentRepetitionThreshold: number;    // 默认 5
  maxWarnings: number;                   // 默认 1
}
```

通过 `AgentConfig` 配置：
```typescript
const agent = new Agent({
  provider,
  loopDetection: {
    enabled: true,
    maxConsecutiveIdenticalCalls: 3,
  },
});

// 关闭循环检测
const agent = new Agent({
  provider,
  loopDetection: { enabled: false },
});
```

#### 新增错误类型

```typescript
class LoopDetectedError extends AgentTeaError {
  constructor(public readonly loopType: 'tool_call' | 'content') {
    super(`检测到循环：重复的${loopType === 'tool_call' ? '工具调用' : '输出内容'}`);
  }
}
```

#### 在 BaseAgent 中的集成点

```
executeLoop() 每轮迭代：
  1. collectResponse() → { text, toolCalls }
  2. if (text) loopDetector.trackContent(text)
  3. if (toolCalls) {
       for each call: loopDetector.trackToolCall(name, args)
       executeToolCalls(...)
     }
  4. const check = loopDetector.check()
     if (check.action === 'warn') → 注入提示到 messages
     if (check.action === 'abort') → throw LoopDetectedError
```

#### 文件组织

```
packages/core/src/agent/
  loop-detection.ts      // ToolCallTracker, ContentTracker, LoopDetector
packages/core/src/errors/
  errors.ts              // 新增 LoopDetectedError
packages/core/src/config/
  types.ts               // 新增 LoopDetectionConfig
```

### 影响范围

- `packages/core/src/agent/loop-detection.ts` — 新增
- `packages/core/src/agent/base-agent.ts` — 集成检测逻辑
- `packages/core/src/agent/react-agent.ts` — executeLoop 中调用检测
- `packages/core/src/agent/plan-and-execute-agent.ts` — 同上
- `packages/core/src/errors/errors.ts` — 新增 LoopDetectedError
- `packages/core/src/config/types.ts` — 新增配置类型

---

## 总体文件变更汇总

### 新增文件

```
packages/core/src/context/pipeline.ts
packages/core/src/context/processors/sliding-window.ts
packages/core/src/context/processors/tool-output-truncator.ts
packages/core/src/context/processors/message-compressor.ts
packages/core/src/tools/builtin/read-file.ts
packages/core/src/tools/builtin/write-file.ts
packages/core/src/tools/builtin/list-directory.ts
packages/core/src/tools/builtin/execute-shell.ts
packages/core/src/tools/builtin/grep.ts
packages/core/src/tools/builtin/web-fetch.ts
packages/core/src/tools/builtin/index.ts
packages/core/src/agent/loop-detection.ts
packages/sdk/src/extensions/builtin-tools.ts
```

### 修改文件

```
packages/core/src/scheduler/scheduler.ts        — 并行分组逻辑
packages/core/src/agent/base-agent.ts            — Scheduler 构造、审批降级、循环检测集成
packages/core/src/agent/react-agent.ts           — 循环检测调用
packages/core/src/agent/plan-and-execute-agent.ts — 循环检测调用
packages/core/src/context/types.ts               — ContextProcessor, TokenBudget 类型
packages/core/src/context/sliding-window.ts      — deprecated，委托给 pipeline
packages/core/src/config/types.ts                — 新增配置类型
packages/core/src/errors/errors.ts               — LoopDetectedError
packages/core/src/index.ts                       — 导出
packages/sdk/src/index.ts                        — 导出
```

### 不变文件

```
packages/core/src/scheduler/executor.ts          — 无需改动
packages/core/src/tools/internal/                — plan mode 工具不动
packages/core/src/approval/                      — 审批逻辑不动
packages/core/src/memory/                        — 持久化不动
```

## 实施顺序建议

1. **模块四（循环检测）** — 最独立，无前置依赖
2. **模块一（并行执行）** — 改 Scheduler，与其他模块无耦合
3. **模块二（上下文压缩管道）** — 重构 context 层
4. **模块三（内置工具集）** — 最后做，可利用模块一的标签和模块二的截断

模块 1 和 4 可以并行开发（不同文件、不同目录）。模块 3 依赖模块 1（标签系统）和模块 2（工具输出截断），放最后。
