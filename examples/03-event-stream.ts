/**
 * 03 - 完整事件流：理解 Agent 生命周期的每一个事件
 *
 * 前置知识：01-hello-agent（Agent、tool、基础事件消费）
 *
 * 本示例新概念：
 * - 完整的 AgentEvent 类型体系（可区分联合 discriminated union）
 * - agent_start / agent_end：Agent 生命周期边界
 * - state_change：Agent 状态机转换（idle → reacting → completed）
 * - usage：Token 用量统计
 * - error：区分 fatal（致命）和非 fatal（可恢复）错误
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/03-event-stream.ts
 *
 *   # 自定义问题：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/03-event-stream.ts "123 + 456 等于多少"
 */

import { Agent, tool, z } from '../packages/sdk/src/index.js';
import type { AgentEvent } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 定义一个计算器工具，让 Agent 有机会触发工具调用事件
// ============================================================

const calculator = tool(
  {
    name: 'calculate',
    description: '计算数学表达式。支持 +、-、*、/ 运算。',
    parameters: z.object({
      expression: z.string().describe('要计算的数学表达式，如 "2 + 3 * 4"'),
    }),
  },
  async ({ expression }) => {
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return `${expression} = ${result}`;
    } catch {
      return { content: `无法计算: ${expression}`, isError: true };
    }
  },
);

// ============================================================
// 创建 Agent
// ============================================================

const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  }),
  model: process.env.MODEL || 'gpt-4o-mini',
  tools: [calculator],
  systemPrompt: '你是一个数学助手。用 calculate 工具完成计算，用中文回答。',
});

// ============================================================
// 完整的事件处理
// AgentEvent 是可区分联合（discriminated union by `type`），
// TypeScript 在 switch/case 中可以自动收窄类型。
// ============================================================

/** 格式化单个事件，用不同前缀和颜色区分事件类型 */
function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    // --- 生命周期事件 ---
    case 'agent_start':
      // Agent 开始运行，sessionId 是此次运行的唯一标识，用于日志关联
      return `[启动] sessionId=${event.sessionId}`;

    case 'agent_end':
      // Agent 运行结束，reason 有四种：complete（正常完成）、error、abort、paused
      return `[结束] reason=${event.reason}, sessionId=${event.sessionId}`;

    // --- 状态机事件 ---
    case 'state_change':
      // Agent 内部状态转换，ReAct 模式的典型路径：idle → reacting → completed
      return `[状态] ${event.from} → ${event.to}`;

    // --- 内容事件 ---
    case 'message':
      // LLM 的文本回复（role='assistant'）或用户输入（role='user'）
      return `[消息] (${event.role}) ${event.content}`;

    // --- 工具事件 ---
    case 'tool_request':
      // LLM 请求调用工具，此时尚未执行
      return `[工具请求] ${event.toolName}(${JSON.stringify(event.args)}) requestId=${event.requestId}`;

    case 'tool_response':
      // 工具执行完毕的返回结果
      const status = event.isError ? '失败' : '成功';
      return `[工具响应] ${event.toolName} [${status}] ${event.content}`;

    // --- 元信息事件 ---
    case 'usage':
      // Token 用量，用于监控成本
      return `[用量] 模型=${event.model} 输入=${event.usage.inputTokens} 输出=${event.usage.outputTokens}`;

    case 'error':
      // fatal=true 会导致 Agent 停止；fatal=false 表示可恢复（如单个工具执行失败）
      return `[错误] ${event.fatal ? '致命' : '可恢复'}: ${event.message}`;

    // --- 审批事件（本示例不会触发，但列出以展示完整性）---
    case 'approval_request':
      return `[审批请求] ${event.toolName}(${JSON.stringify(event.args)})`;

    // --- 计划执行事件（PlanAndExecuteAgent 才会触发）---
    case 'plan_created':
      return `[计划创建] ${event.plan.steps.length} 个步骤`;

    case 'step_start':
      return `[步骤开始] #${event.step.index}: ${event.step.description}`;

    case 'step_complete':
      return `[步骤完成] #${event.step.index}`;

    case 'step_failed':
      return `[步骤失败] #${event.step.index}: ${event.error}`;

    case 'execution_paused':
      return `[执行暂停] #${event.step.index}: ${event.error}`;

    default:
      // TypeScript 穷尽检查：如果框架新增了事件类型而这里没处理，编译期会报错
      const _exhaustiveCheck: never = event;
      return `[未知事件] ${JSON.stringify(_exhaustiveCheck)}`;
  }
}

// ============================================================
// 运行并观察完整事件流
// ============================================================

async function main() {
  const query = process.argv[2] || '帮我计算 (123 + 456) * 2 和 999 / 3';
  console.log(`> ${query}\n`);
  console.log('--- 事件流开始 ---\n');

  // 统计各类事件的出现次数
  const eventCounts = new Map<string, number>();

  for await (const event of agent.run(query)) {
    // 打印格式化后的事件
    console.log(formatEvent(event));

    // 统计
    eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
  }

  // 打印事件统计
  console.log('\n--- 事件统计 ---');
  for (const [type, count] of eventCounts) {
    console.log(`  ${type}: ${count} 次`);
  }

  console.log('\n完成。');
}

main().catch(console.error);
