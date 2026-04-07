/**
 * 11-plan-and-execute.ts —— PlanAndExecuteAgent 部署助手示例
 *
 * 前置知识：
 *   - 01-basic-agent.ts（Agent 基础、工具定义、事件消费）
 *   - 03-sub-agent.ts（多 Agent 概念）
 *   - 04-approval-and-memory.ts（审批系统、事件消费模式）
 *   - 07-xxx（工具标签概念）
 *
 * 新概念：
 *   - PlanAndExecuteAgent —— 三阶段工作流：规划 → 审批 → 执行
 *   - PlanStore —— 基于文件的计划持久化
 *   - onPlanCreated / onStepFailed / onStepStart / onStepComplete 钩子
 *   - plan_created / step_start / step_complete / step_failed / execution_paused 事件
 *   - 工具标签过滤 —— 规划阶段仅暴露 readonly 标签的工具
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/11-plan-and-execute.ts
 *
 *   # 使用火山引擎 / DeepSeek 等兼容 API：
 *   OPENAI_API_KEY=your-key OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 \
 *   MODEL=your-endpoint-id npx tsx examples/11-plan-and-execute.ts
 *
 * 场景说明：
 *   模拟一个"部署助手"。Agent 先用只读工具探索环境（检查服务状态、获取配置），
 *   生成部署计划并等待用户确认，然后逐步执行写操作（部署、回滚、通知）。
 *   其中 deployService 会随机失败来演示 onStepFailed 的错误恢复。
 */

import * as readline from 'node:readline';
import { PlanAndExecuteAgent, PlanStore, tool, z } from '../packages/sdk/src/index.js';
import type { PlanStep, StepResult, Plan, PlanApproval, StepFailureAction } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 模拟数据
// ============================================================

const services: Record<string, { status: string; version: string }> = {
  'api-gateway': { status: 'running', version: 'v2.3.1' },
  'user-service': { status: 'running', version: 'v1.8.0' },
  'order-service': { status: 'degraded', version: 'v3.1.2' },
};

const deployConfig = {
  targetVersion: 'v3.2.0',
  environment: 'production',
  rollbackTimeout: 300,
  healthCheckInterval: 10,
  notifyChannels: ['#deploy', '#ops'],
};

const deployLog: string[] = [];

// ============================================================
// 只读工具（tags: ['readonly']）—— 规划阶段可用
// ============================================================

/** 检查服务状态 */
const checkServiceStatus = tool(
  {
    name: 'check_service_status',
    description: '检查指定服务的当前运行状态和版本信息',
    parameters: z.object({
      serviceName: z.string().describe('服务名称，如 api-gateway, user-service'),
    }),
    tags: ['readonly'],
  },
  async ({ serviceName }) => {
    const svc = services[serviceName];
    if (!svc) {
      return { content: `服务 "${serviceName}" 不存在。可用服务: ${Object.keys(services).join(', ')}`, isError: true };
    }
    return JSON.stringify({ name: serviceName, ...svc }, null, 2);
  },
);

/** 获取部署配置 */
const getDeployConfig = tool(
  {
    name: 'get_deploy_config',
    description: '获取当前环境的部署配置信息（目标版本、回滚超时等）',
    parameters: z.object({}),
    tags: ['readonly'],
  },
  async () => {
    return JSON.stringify(deployConfig, null, 2);
  },
);

// ============================================================
// 写操作工具（无 readonly 标签）—— 仅执行阶段可用
// ============================================================

/** 部署服务（随机失败，演示 onStepFailed） */
const deployService = tool(
  {
    name: 'deploy_service',
    description: '将指定服务部署到目标版本',
    parameters: z.object({
      serviceName: z.string().describe('要部署的服务名称'),
      version: z.string().describe('目标版本号'),
    }),
  },
  async ({ serviceName, version }) => {
    // 30% 概率模拟部署失败
    if (Math.random() < 0.3) {
      deployLog.push(`[FAIL] ${serviceName} 部署到 ${version} 失败 — 健康检查未通过`);
      return { content: `部署失败: ${serviceName} 健康检查未通过，容器启动超时`, isError: true };
    }

    // 更新模拟数据
    services[serviceName] = { status: 'running', version };
    deployLog.push(`[OK] ${serviceName} 部署到 ${version} 成功`);
    return `服务 ${serviceName} 已成功部署到 ${version}`;
  },
);

/** 回滚服务 */
const rollbackService = tool(
  {
    name: 'rollback_service',
    description: '将指定服务回滚到上一个版本',
    parameters: z.object({
      serviceName: z.string().describe('要回滚的服务名称'),
    }),
  },
  async ({ serviceName }) => {
    const svc = services[serviceName];
    if (!svc) {
      return { content: `服务 "${serviceName}" 不存在`, isError: true };
    }
    deployLog.push(`[ROLLBACK] ${serviceName} 已回滚到 ${svc.version}`);
    return `服务 ${serviceName} 已回滚到 ${svc.version}`;
  },
);

/** 通知团队 */
const notifyTeam = tool(
  {
    name: 'notify_team',
    description: '向团队频道发送部署通知',
    parameters: z.object({
      channel: z.string().describe('通知频道，如 #deploy'),
      message: z.string().describe('通知内容'),
    }),
  },
  async ({ channel, message }) => {
    deployLog.push(`[NOTIFY] ${channel}: ${message}`);
    return `通知已发送到 ${channel}`;
  },
);

// ============================================================
// 用户交互辅助
// ============================================================

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================
// 自定义 PlanAndExecuteAgent 子类 —— 覆写生命周期钩子
// ============================================================

/**
 * 部署助手 Agent。
 *
 * 为什么需要子类？
 * PlanAndExecuteAgent 的生命周期钩子（onPlanCreated, onStepFailed 等）
 * 是 protected 方法，通过覆写来注入自定义行为。
 * 这种模式比回调配置更类型安全，也更易于测试。
 */
class DeployAssistant extends PlanAndExecuteAgent {
  /** 计划创建后：展示给用户并等待确认 */
  protected override async onPlanCreated(plan: Plan): Promise<PlanApproval> {
    console.log('\n' + '='.repeat(50));
    console.log('  执行计划');
    console.log('='.repeat(50));
    plan.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.description}`);
    });
    console.log('='.repeat(50));

    const answer = await askUser('\n确认执行此计划？(Y/n) ');
    const approved = answer === '' || answer.toLowerCase().startsWith('y');

    if (!approved) {
      const feedback = await askUser('请说明拒绝原因（直接回车跳过）: ');
      return {
        approved: false,
        feedback: feedback || '用户取消了部署计划，请根据用户意见重新规划',
      };
    }

    return { approved: true };
  }

  /** 步骤开始时：打印进度 */
  protected override async onStepStart(step: PlanStep): Promise<void> {
    console.log(`\n--- [步骤 ${step.index + 1}] 开始: ${step.description} ---`);
  }

  /** 步骤完成时：打印结果 */
  protected override async onStepComplete(step: PlanStep, result: StepResult): Promise<void> {
    console.log(`--- [步骤 ${step.index + 1}] 完成 (${result.toolCallCount} 次工具调用) ---`);
  }

  /** 步骤失败时：让用户选择恢复策略 */
  protected override async onStepFailed(step: PlanStep, error: Error): Promise<StepFailureAction> {
    console.log(`\n!!! 步骤 ${step.index + 1} 执行失败 !!!`);
    console.log(`    步骤: ${step.description}`);
    console.log(`    错误: ${error.message}`);
    console.log();
    console.log('  请选择处理方式:');
    console.log('  1. abort  — 终止整个部署');
    console.log('  2. skip   — 跳过此步骤，继续下一步');
    console.log('  3. replan — 重新制定部署计划');
    console.log('  4. pause  — 暂停执行（可稍后恢复）');

    const choice = await askUser('\n请输入选择 (1-4，默认 1): ');

    const actionMap: Record<string, StepFailureAction> = {
      '1': 'abort',
      '2': 'skip',
      '3': 'replan',
      '4': 'pause',
    };

    return actionMap[choice] ?? 'abort';
  }
}

// ============================================================
// 创建 Agent 实例
// ============================================================

const planStore = new PlanStore('.agent-tea/plans');

const agent = new DeployAssistant({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  }),
  model: process.env.MODEL || 'gpt-4o-mini',
  tools: [checkServiceStatus, getDeployConfig, deployService, rollbackService, notifyTeam],
  systemPrompt: `你是一个部署助手。你的工作流程：
1. 先用只读工具（check_service_status, get_deploy_config）了解当前环境
2. 制定清晰的部署计划，每步一行，用编号列表格式
3. 等待用户确认后逐步执行

重要规则：
- 规划阶段只能使用 check_service_status 和 get_deploy_config
- 每个步骤描述要清晰具体，包含服务名和操作
- 部署完成后要通知团队`,
  planStoreDir: '.agent-tea/plans',
  maxIterations: 15,
});

// ============================================================
// 主函数 —— 运行 Agent 并消费事件
// ============================================================

async function main() {
  const query = process.argv[2] || '请将 order-service 部署到最新版本，部署前先检查所有服务状态';

  console.log('='.repeat(50));
  console.log('  部署助手 (PlanAndExecuteAgent 示例)');
  console.log('='.repeat(50));
  console.log();
  console.log(`> ${query}`);

  for await (const event of agent.run(query)) {
    switch (event.type) {
      // ---- 基础事件 ----
      case 'message':
        console.log(`\n[Assistant] ${event.content}`);
        break;

      case 'tool_request':
        console.log(`  -> 调用 ${event.toolName}(${JSON.stringify(event.args)})`);
        break;

      case 'tool_response':
        // 截断过长的工具输出
        const content = event.content.length > 200
          ? event.content.slice(0, 200) + '...'
          : event.content;
        console.log(`  <- ${event.isError ? '[错误] ' : ''}${content}`);
        break;

      case 'usage':
        console.log(`  [Token] in=${event.usage.inputTokens} out=${event.usage.outputTokens}`);
        break;

      // ---- 状态变更 ----
      case 'state_change':
        console.log(`  [状态] ${event.from} -> ${event.to}`);
        break;

      // ---- 计划相关事件 ----
      case 'plan_created':
        // 计划创建事件（onPlanCreated 钩子已在子类中处理了用户交互）
        console.log(`  [计划] 已创建，包含 ${event.plan.steps.length} 个步骤`);
        if (event.filePath) {
          console.log(`  [计划] 已保存到 ${event.filePath}`);
        }
        break;

      case 'step_start':
        // onStepStart 钩子已打印，这里做补充
        break;

      case 'step_complete':
        // onStepComplete 钩子已打印
        break;

      case 'step_failed':
        // onStepFailed 钩子已处理用户选择
        console.log(`  [步骤失败] 步骤 ${event.step.index + 1}: ${event.step.description}`);
        break;

      case 'execution_paused':
        console.log(`\n[暂停] 执行已暂停在步骤 ${event.step.index + 1}`);
        console.log('  可以稍后恢复执行');
        break;

      // ---- 错误 ----
      case 'error':
        console.error(`\n[错误] ${event.fatal ? '致命: ' : ''}${event.message}`);
        break;

      // ---- Agent 生命周期 ----
      case 'agent_end':
        console.log(`\n[结束] Agent 运行结束，原因: ${event.reason}`);
        break;
    }
  }

  // 展示部署日志
  if (deployLog.length > 0) {
    console.log('\n' + '='.repeat(50));
    console.log('  部署日志');
    console.log('='.repeat(50));
    for (const entry of deployLog) {
      console.log(`  ${entry}`);
    }
  }

  // 展示最终服务状态
  console.log('\n' + '='.repeat(50));
  console.log('  最终服务状态');
  console.log('='.repeat(50));
  for (const [name, svc] of Object.entries(services)) {
    console.log(`  ${name}: ${svc.status} (${svc.version})`);
  }
}

main().catch(console.error);
