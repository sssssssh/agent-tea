/**
 * 13-error-recovery.ts —— 错误处理与恢复策略演示
 *
 * 前置知识：
 *   - 01-basic-agent.ts（Agent 基础、工具定义、事件消费）
 *
 * 新概念：
 *   - retryWithBackoff —— 带指数退避和抖动的异步重试函数
 *   - ProviderError —— LLM 通信错误，携带 statusCode 和 retryable 标志
 *   - MaxIterationsError —— Agent 循环超过最大迭代次数时的安全阀错误
 *   - 工具执行错误不会崩溃 Agent —— 框架将异常包装为 ToolResult(isError: true)
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/13-error-recovery.ts
 *
 * 场景说明：
 *   依次演示三种错误场景：
 *   1. Provider 限流重试 —— retryWithBackoff 自动处理 429 错误
 *   2. Agent 迭代上限 —— maxIterations 安全阀触发 MaxIterationsError
 *   3. 工具执行异常 —— 框架自动包装为安全的 ToolResult
 */

import {
  Agent,
  tool,
  z,
  retryWithBackoff,
  ProviderError,
  MaxIterationsError,
} from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// Provider 配置
// ============================================================

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});
const model = process.env.MODEL || 'gpt-4o-mini';

// ============================================================
// 场景 1: Provider 限流重试
// ============================================================

/**
 * 演示 retryWithBackoff 如何处理可重试的 Provider 错误。
 *
 * retryWithBackoff 的核心机制：
 * - 指数退避: 每次重试间隔翻倍（1s -> 2s -> 4s...）
 * - 随机抖动: 防止多个客户端同时重试造成"惊群效应"
 * - 可插拔判断: 通过 isRetryable 回调决定哪些错误值得重试
 * - 支持取消: 通过 AbortSignal 在等待期间也能及时响应
 */
async function scenario1_providerRetry() {
  console.log('='.repeat(60));
  console.log('  场景 1: Provider 限流重试 (retryWithBackoff)');
  console.log('='.repeat(60));
  console.log();

  // 模拟一个前两次返回 429、第三次成功的 API 调用
  let attemptCount = 0;

  try {
    const result = await retryWithBackoff(
      async (attempt) => {
        attemptCount++;
        console.log(`  [尝试 #${attempt}] 发送 API 请求...`);

        if (attemptCount <= 2) {
          // 前两次模拟 429 限流
          throw new ProviderError(
            'Rate limit exceeded. Please retry after 1 second.',
            429,
            true, // retryable = true
          );
        }

        // 第三次成功
        return '模拟 LLM 响应: 你好！这是一个成功的响应。';
      },
      {
        maxAttempts: 5,
        initialDelayMs: 500,   // 演示用，实际场景建议 1000ms
        maxDelayMs: 5000,
        jitter: 0.2,
        // 只重试 retryable 的 ProviderError
        isRetryable: (error) => {
          if (error instanceof ProviderError) {
            return error.retryable;
          }
          return false; // 其他错误不重试
        },
        // 每次重试前打印日志
        onRetry: (attempt, error, delayMs) => {
          const msg = error instanceof Error ? error.message : String(error);
          console.log(`  [重试] 第 ${attempt} 次失败: ${msg}`);
          console.log(`         等待 ${Math.round(delayMs)}ms 后重试...`);
        },
      },
    );

    console.log(`\n  [成功] 第 ${attemptCount} 次尝试返回: ${result}`);
  } catch (error) {
    console.error(`  [最终失败] ${error}`);
  }

  // 演示不可重试的错误
  console.log('\n  --- 对比: 不可重试的错误 (401 认证失败) ---\n');

  try {
    await retryWithBackoff(
      async (attempt) => {
        console.log(`  [尝试 #${attempt}] 发送 API 请求...`);
        throw new ProviderError(
          'Invalid API key provided.',
          401,
          false, // retryable = false
        );
      },
      {
        maxAttempts: 3,
        initialDelayMs: 500,
        isRetryable: (error) => {
          if (error instanceof ProviderError) {
            return error.retryable;
          }
          return false;
        },
        onRetry: (attempt, error, delayMs) => {
          console.log(`  [重试] 第 ${attempt} 次失败，等待 ${Math.round(delayMs)}ms...`);
        },
      },
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      console.log(`  [立即失败] statusCode=${error.statusCode}, retryable=${error.retryable}`);
      console.log(`  消息: ${error.message}`);
      console.log('  (不可重试的错误不会触发退避重试，直接抛出)');
    }
  }
}

// ============================================================
// 场景 2: Agent 迭代上限
// ============================================================

/**
 * 演示 maxIterations 安全阀如何防止 Agent 无限循环。
 *
 * 当 Agent 的 ReAct 循环超过 maxIterations 次后，
 * 框架会抛出错误事件并终止 Agent，而不是无限消耗 token。
 */
async function scenario2_maxIterations() {
  console.log('\n' + '='.repeat(60));
  console.log('  场景 2: Agent 迭代上限 (maxIterations)');
  console.log('='.repeat(60));
  console.log();

  // 一个"永远需要更多步骤"的工具
  let stepCount = 0;
  const infiniteTask = tool(
    {
      name: 'next_step',
      description: '执行下一步任务操作',
      parameters: z.object({
        step: z.string().describe('当前步骤描述'),
      }),
    },
    async ({ step }) => {
      stepCount++;
      console.log(`    [next_step #${stepCount}] ${step}`);
      // 每次都告诉 LLM 还需要继续
      return `步骤 "${step}" 已完成。但还有更多工作要做，请继续执行下一步。（提示: 你不需要一直调用这个工具，如果你认为任务已经完成了，请直接给出总结。）`;
    },
  );

  const agent = new Agent({
    provider,
    model,
    tools: [infiniteTask],
    systemPrompt: '你是一个任务执行助手。按步骤执行任务，每步都要调用 next_step 工具。',
    // 故意设置很小的迭代上限来触发安全阀
    maxIterations: 3,
    // 禁用循环检测，专门测试 maxIterations
    loopDetection: { enabled: false },
  });

  const query = '帮我完成一个复杂的数据迁移任务，需要很多步骤';
  console.log(`> ${query}\n`);

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`  [Assistant] ${event.content.slice(0, 100)}${event.content.length > 100 ? '...' : ''}`);
        break;

      case 'tool_request':
        console.log(`  -> ${event.toolName}(${JSON.stringify(event.args).slice(0, 80)}...)`);
        break;

      case 'tool_response':
        // 工具内部已打印
        break;

      case 'error':
        console.log(`\n  [错误] ${event.message}`);
        if (event.message.includes('maximum iterations')) {
          console.log('  (这是 maxIterations 安全阀触发的预期行为)');
          console.log(`  Agent 在 ${stepCount} 次工具调用后被终止`);
        }
        break;

      case 'agent_end':
        console.log(`  [结束] 原因: ${event.reason}`);
        break;
    }
  }

  console.log(`\n  总结: maxIterations=3 限制了 Agent 循环次数，防止无限消耗 token`);
}

// ============================================================
// 场景 3: 工具执行异常不会崩溃 Agent
// ============================================================

/**
 * 演示框架的"工具永不抛异常"设计原则。
 *
 * 当工具内部抛出异常时，ToolExecutor 会自动将其包装为
 * ToolResult({ content: errorMessage, isError: true })。
 * LLM 看到 isError=true 后可以调整策略（比如换个工具或换个参数）。
 *
 * 这个设计保证了 Agent 循环的安全性 —— 单个工具失败不会导致整个 Agent 崩溃。
 */
async function scenario3_toolError() {
  console.log('\n' + '='.repeat(60));
  console.log('  场景 3: 工具执行异常的安全处理');
  console.log('='.repeat(60));
  console.log();

  // 一个随机抛异常的工具
  const unstableApi = tool(
    {
      name: 'call_external_api',
      description: '调用外部 API 获取数据。注意：这个 API 不太稳定，可能会失败。失败时可以换个 endpoint 重试。',
      parameters: z.object({
        endpoint: z.string().describe('API 端点路径，如 /users 或 /products'),
      }),
    },
    async ({ endpoint }) => {
      console.log(`    [call_external_api] 请求 ${endpoint}`);

      // /users 端点会抛异常，模拟不稳定的外部服务
      if (endpoint.includes('users')) {
        // 这个异常会被框架自动捕获，不会崩溃 Agent
        throw new Error('Connection timeout: external API at /users is not responding (ETIMEDOUT)');
      }

      // /products 端点正常返回
      if (endpoint.includes('products')) {
        return JSON.stringify([
          { id: 1, name: 'Widget A', price: 29.99 },
          { id: 2, name: 'Widget B', price: 49.99 },
        ]);
      }

      return { content: `未知端点: ${endpoint}`, isError: true };
    },
  );

  // 一个始终正常的备用工具
  const localCache = tool(
    {
      name: 'query_local_cache',
      description: '从本地缓存查询数据。始终可用，但数据可能不是最新的。',
      parameters: z.object({
        dataType: z.string().describe('数据类型，如 users 或 products'),
      }),
    },
    async ({ dataType }) => {
      console.log(`    [query_local_cache] 查询 ${dataType}`);
      const cache: Record<string, string> = {
        users: JSON.stringify([{ id: 1, name: '张三', role: '开发者' }, { id: 2, name: '李四', role: '设计师' }]),
        products: JSON.stringify([{ id: 1, name: '缓存产品 A' }]),
      };
      return cache[dataType] ?? `缓存中没有 ${dataType} 类型的数据`;
    },
  );

  const agent = new Agent({
    provider,
    model,
    tools: [unstableApi, localCache],
    systemPrompt: `你是一个数据查询助手。先尝试用 call_external_api 获取最新数据。
如果 API 调用失败（你会在工具结果中看到错误信息），
请改用 query_local_cache 从本地缓存获取。用中文回答。`,
    maxIterations: 6,
  });

  const query = '帮我查一下用户列表和产品列表';
  console.log(`> ${query}\n`);

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`\n  [Assistant] ${event.content}`);
        break;

      case 'tool_request':
        console.log(`  -> ${event.toolName}(${JSON.stringify(event.args)})`);
        break;

      case 'tool_response':
        if (event.isError) {
          // 框架将工具异常包装为了 isError=true 的 ToolResult
          console.log(`  <- [工具错误] ${event.content}`);
          console.log('     (异常被框架安全捕获，Agent 循环继续运行)');
        } else {
          const display = event.content.length > 100
            ? event.content.slice(0, 100) + '...'
            : event.content;
          console.log(`  <- ${display}`);
        }
        break;

      case 'agent_end':
        console.log(`\n  [结束] 原因: ${event.reason}`);
        break;
    }
  }

  console.log('\n  总结: 工具抛出的异常被框架自动包装为 ToolResult(isError=true)');
  console.log('  LLM 看到错误后切换到了备用的 query_local_cache 工具');
  console.log('  整个过程 Agent 循环没有中断');
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log();
  console.log('本示例演示 agent-tea 框架的三层错误处理策略:');
  console.log('  1. retryWithBackoff —— Provider 层的自动重试');
  console.log('  2. maxIterations    —— Agent 层的安全阀');
  console.log('  3. 工具错误包装    —— Tool 层的异常隔离');
  console.log();

  await scenario1_providerRetry();
  await scenario2_maxIterations();
  await scenario3_toolError();

  console.log('\n' + '='.repeat(60));
  console.log('  错误处理策略总结');
  console.log('='.repeat(60));
  console.log();
  console.log('  层级      | 机制              | 适用场景');
  console.log('  ----------|-------------------|---------------------------');
  console.log('  Provider  | retryWithBackoff  | 429 限流、503 暂时不可用');
  console.log('  Agent     | maxIterations     | LLM 陷入无限循环');
  console.log('  Tool      | 异常 -> ToolResult | 单个工具执行失败');
  console.log();
  console.log('  三层机制协同工作，确保 Agent 在各种异常情况下都能安全降级。');
}

main().catch(console.error);
