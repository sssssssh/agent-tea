/**
 * 12-loop-detection.ts —— 循环检测演示
 *
 * 前置知识：
 *   - 01-basic-agent.ts（Agent 基础、工具定义、事件消费）
 *
 * 新概念：
 *   - LoopDetector —— 检测 Agent 是否陷入循环（重复工具调用 / 重复内容输出）
 *   - LoopDetectionConfig —— 循环检测配置（阈值、警告次数）
 *   - LoopDetectedError —— 循环检测触发后抛出的错误，携带 loopType 信息
 *   - 分级策略 —— 首次循环发出警告（给 LLM 自我纠正的机会），超过 maxWarnings 后终止
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/12-loop-detection.ts
 *
 * 场景说明：
 *   创建一个"永远回答不了"的场景 —— lookupAnswer 工具始终返回"信息不足"。
 *   Agent 会反复调用这个工具，循环检测器在连续 3 次相同调用后发出警告，
 *   警告 1 次后仍然循环则抛出 LoopDetectedError 终止 Agent。
 *
 *   通过对比"无循环检测"和"有循环检测"两种模式，
 *   直观展示循环检测如何保护 Agent 不浪费 token。
 */

import { Agent, tool, z, LoopDetectedError } from '../packages/sdk/src/index.js';
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
// 定义一个"永远回答不了"的工具
// ============================================================

/**
 * 模拟一个有问题的知识库查询工具。
 * 无论查什么都返回"信息不足"，导致 Agent 反复调用。
 * 这在实际场景中很常见 —— 比如外部 API 持续返回空结果。
 */
const lookupAnswer = tool(
  {
    name: 'lookup_answer',
    description: '从知识库中查找问题的答案',
    parameters: z.object({
      question: z.string().describe('要查询的问题'),
      source: z.enum(['internal', 'external']).optional().describe('查询源，默认 internal'),
    }),
  },
  async ({ question, source }) => {
    // 记录调用次数，方便观察循环
    callCount++;
    const src = source ?? 'internal';
    console.log(`    [lookupAnswer #${callCount}] 查询: "${question}" (来源: ${src})`);

    // 永远返回"信息不足"
    return `查询 "${question}" 从 ${src} 源未找到明确答案，信息不足，建议换个关键词再试一次。`;
  },
);

let callCount = 0;

// ============================================================
// 场景 1：有循环检测 —— Agent 被及时终止
// ============================================================

async function scenarioWithDetection() {
  console.log('='.repeat(60));
  console.log('  场景 1: 启用循环检测（推荐）');
  console.log('='.repeat(60));
  console.log();

  callCount = 0;

  const agent = new Agent({
    provider,
    model,
    tools: [lookupAnswer],
    systemPrompt: '你是一个查询助手。必须用 lookup_answer 工具查找答案，不要猜测。',
    // 最多 10 次迭代（作为兜底）
    maxIterations: 10,
    // 循环检测配置
    loopDetection: {
      enabled: true,
      maxConsecutiveIdenticalCalls: 3, // 连续 3 次完全相同的调用触发检测
      maxWarnings: 1,                   // 警告 1 次后终止（总共允许 3+3=6 次相同调用）
    },
  });

  const query = '量子计算机的工作原理是什么？';
  console.log(`> ${query}\n`);

  try {
    for await (const event of agent.run(query)) {
      switch (event.type) {
        case 'message':
          console.log(`  [Assistant] ${event.content.slice(0, 150)}${event.content.length > 150 ? '...' : ''}`);
          break;

        case 'tool_request':
          console.log(`  -> ${event.toolName}(${JSON.stringify(event.args)})`);
          break;

        case 'tool_response':
          // lookupAnswer 的输出已在工具内部打印，这里简化
          break;

        case 'usage':
          console.log(`  [Token] in=${event.usage.inputTokens} out=${event.usage.outputTokens}`);
          break;

        case 'error':
          console.log(`  [错误] ${event.message}`);
          // 判断是否是循环检测触发的错误
          if (event.message.includes('Loop detected')) {
            console.log('         Agent 被检测到陷入循环，已自动终止');
          }
          break;

        case 'agent_end':
          console.log(`\n  [结束] 原因: ${event.reason}`);
          break;
      }
    }
  } catch (err) {
    // LoopDetectedError 会被框架捕获并转为 error 事件 + agent_end，
    // 但如果在 for-await 之外也想处理，可以在这里 catch
    if (err instanceof LoopDetectedError) {
      console.log(`\n  [LoopDetectedError] 循环类型: ${err.loopType}`);
      console.log(`  消息: ${err.message}`);
    } else {
      throw err;
    }
  }

  console.log(`\n  总工具调用次数: ${callCount}`);
  console.log('  (循环检测阻止了无意义的重复调用，节省了 token)\n');
}

// ============================================================
// 场景 2：无循环检测 —— Agent 耗尽迭代上限
// ============================================================

async function scenarioWithoutDetection() {
  console.log('='.repeat(60));
  console.log('  场景 2: 禁用循环检测（对比用）');
  console.log('='.repeat(60));
  console.log();

  callCount = 0;

  const agent = new Agent({
    provider,
    model,
    tools: [lookupAnswer],
    systemPrompt: '你是一个查询助手。必须用 lookup_answer 工具查找答案，不要猜测。',
    // 设置很小的迭代上限，避免演示时花太多钱
    maxIterations: 5,
    // 禁用循环检测
    loopDetection: {
      enabled: false,
    },
  });

  const query = '量子计算机的工作原理是什么？';
  console.log(`> ${query}\n`);

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`  [Assistant] ${event.content.slice(0, 150)}${event.content.length > 150 ? '...' : ''}`);
        break;

      case 'tool_request':
        console.log(`  -> ${event.toolName}(${JSON.stringify(event.args)})`);
        break;

      case 'usage':
        console.log(`  [Token] in=${event.usage.inputTokens} out=${event.usage.outputTokens}`);
        break;

      case 'error':
        console.log(`  [错误] ${event.message}`);
        break;

      case 'agent_end':
        console.log(`\n  [结束] 原因: ${event.reason}`);
        break;
    }
  }

  console.log(`\n  总工具调用次数: ${callCount}`);
  console.log('  (没有循环检测，Agent 耗尽了全部迭代次数)\n');
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log();
  console.log('本示例演示循环检测机制如何保护 Agent 不陷入无意义的重复调用。');
  console.log('对比"有检测"和"无检测"两种模式下的工具调用次数和 token 消耗。');
  console.log();

  // 先演示有循环检测的情况
  await scenarioWithDetection();

  console.log('\n' + '-'.repeat(60) + '\n');

  // 再演示无循环检测的情况
  await scenarioWithoutDetection();

  // 总结
  console.log('='.repeat(60));
  console.log('  总结');
  console.log('='.repeat(60));
  console.log();
  console.log('  循环检测是一个重要的安全机制：');
  console.log('  1. 防止 Agent 在无效操作上浪费 token（省钱）');
  console.log('  2. 及时终止无意义的循环，提升用户体验');
  console.log('  3. 分级策略：先警告（给 LLM 自我纠正的机会），再终止');
  console.log('  4. 检测两种循环：重复工具调用 + 重复内容输出');
  console.log();
  console.log('  推荐配置（框架默认值）：');
  console.log('    maxConsecutiveIdenticalCalls: 3');
  console.log('    contentRepetitionThreshold: 5');
  console.log('    maxWarnings: 1');
}

main().catch(console.error);
