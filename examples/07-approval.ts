/**
 * 示例 07 — 审批系统（Approval System）
 *
 * 前置知识：01-basic-agent（Agent 基本用法）、03 或 approval-and-memory（工具定义）
 * 新概念：
 *   - ApprovalPolicy（tagged 模式）—— 按标签决定哪些工具需要人工审批
 *   - approval_request 事件 —— Agent 暂停执行，等待用户确认
 *   - agent.resolveApproval() —— 用户做出审批决定后恢复执行
 *   - 工具标签（tags）—— 用 tags 给工具分级：只读、写操作、不可逆操作
 *
 * 场景：项目管理助手
 *   - 查看任务（只读）—— 自动放行，无需确认
 *   - 创建任务（写操作）—— 需要用户确认
 *   - 发送通知（不可逆）—— 需要用户确认，且提示更强烈的警告
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/07-approval.ts
 *   OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://your-api.com/v1 MODEL=your-model npx tsx examples/07-approval.ts
 */

import * as readline from 'node:readline';
import { Agent, tool, z } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 模拟数据 —— 用数组充当简易数据库
// ============================================================

interface Task {
  id: number;
  title: string;
  assignee: string;
  status: string;
}

const tasks: Task[] = [
  { id: 1, title: '完成需求文档', assignee: '张三', status: '进行中' },
  { id: 2, title: '设计数据库 Schema', assignee: '李四', status: '待开始' },
  { id: 3, title: '编写 API 接口', assignee: '王五', status: '待开始' },
];

const sentNotifications: string[] = [];

// ============================================================
// 工具定义 —— 注意 tags 的不同级别
// ============================================================

// 只读工具，tags: ['readonly']，不需要审批
const listTasks = tool(
  {
    name: 'list_tasks',
    description: '列出当前所有项目任务',
    parameters: z.object({}),
    tags: ['readonly'],
  },
  async () => {
    if (tasks.length === 0) return '当前没有任务';
    return tasks
      .map((t) => `#${t.id} [${t.status}] ${t.title} (@${t.assignee})`)
      .join('\n');
  },
);

// 只读工具，tags: ['readonly']，查看单个任务详情
const getTask = tool(
  {
    name: 'get_task',
    description: '查看某个任务的详细信息',
    parameters: z.object({
      taskId: z.number().describe('任务 ID'),
    }),
    tags: ['readonly'],
  },
  async ({ taskId }) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { content: `任务 #${taskId} 不存在`, isError: true };
    return JSON.stringify(task, null, 2);
  },
);

// 写操作工具，tags: ['write']，需要审批
const createTask = tool(
  {
    name: 'create_task',
    description: '创建一个新的项目任务',
    parameters: z.object({
      title: z.string().describe('任务标题'),
      assignee: z.string().describe('负责人姓名'),
    }),
    tags: ['write'],
  },
  async ({ title, assignee }) => {
    const newId = tasks.length + 1;
    const task: Task = { id: newId, title, assignee, status: '待开始' };
    tasks.push(task);
    return `已创建任务 #${newId}: ${title} (@${assignee})`;
  },
);

// 危险操作工具，tags: ['write', 'irreversible']，需要审批
const sendNotification = tool(
  {
    name: 'send_notification',
    description: '给团队成员发送通知消息（发出后不可撤回）',
    parameters: z.object({
      to: z.string().describe('接收人姓名'),
      message: z.string().describe('通知内容'),
    }),
    tags: ['write', 'irreversible'],
  },
  async ({ to, message }) => {
    const notification = `[通知] -> ${to}: ${message}`;
    sentNotifications.push(notification);
    return `通知已成功发送给 ${to}`;
  },
);

// ============================================================
// 创建 Agent —— 关键：配置 approvalPolicy
// ============================================================

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const agent = new Agent({
  provider,
  model: process.env.MODEL || 'gpt-4o-mini',
  tools: [listTasks, getTask, createTask, sendNotification],
  systemPrompt: `你是一个项目管理助手。你可以查看任务、创建任务和发送通知。
请用中文回答。执行写操作时向用户说明你将要做什么。`,

  // 审批策略：tagged 模式
  // 只有带 'write' 标签的工具需要审批 —— listTasks/getTask 自动放行
  // createTask 和 sendNotification 都带 'write' 标签，会触发审批流程
  approvalPolicy: {
    mode: 'tagged',
    requireApprovalTags: ['write'],
  },
});

// ============================================================
// 命令行交互式审批 —— 核心流程
// ============================================================

/**
 * 用 readline 向用户提问，返回布尔值
 */
function askUserConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      // 回车默认为确认，输入 n/N 为拒绝
      resolve(!answer.toLowerCase().startsWith('n'));
    });
  });
}

// ============================================================
// 主流程 —— 消费事件流，处理审批请求
// ============================================================

async function main() {
  const query =
    process.argv[2] ||
    '帮我看看现在有哪些任务，然后创建一个新任务"部署 CI/CD 流水线"分配给赵六，最后通知赵六他有新任务了';

  console.log('='.repeat(60));
  console.log('  审批系统演示 —— tagged 模式');
  console.log('  只读工具自动放行，写操作工具需要人工确认');
  console.log('='.repeat(60));
  console.log();
  console.log(`用户: ${query}`);
  console.log();

  for await (const event of agent.run(query)) {
    switch (event.type) {
      // ---- 核心：处理审批请求 ----
      case 'approval_request': {
        // Agent 暂停在这里，等待我们调用 resolveApproval
        const isIrreversible = event.toolName === 'send_notification';
        const prefix = isIrreversible ? '[!!! 不可逆操作]' : '[写操作]';

        console.log();
        console.log(`${prefix} 需要确认: ${event.toolName}`);
        console.log(`  描述: ${event.toolDescription}`);
        console.log(`  参数: ${JSON.stringify(event.args, null, 2)}`);

        const approved = await askUserConfirm('  是否批准执行？(Y/n) ');

        // 调用 resolveApproval 恢复 Agent 执行
        // 如果拒绝，reason 会作为错误信息反馈给 LLM，LLM 可以据此调整策略
        agent.resolveApproval(event.requestId, {
          approved,
          reason: approved ? undefined : '用户拒绝了此操作',
        });

        console.log(approved ? '  -> 已批准' : '  -> 已拒绝');
        console.log();
        break;
      }

      // ---- 其他事件的常规处理 ----
      case 'message':
        console.log(`助手: ${event.content}`);
        break;

      case 'tool_request':
        console.log(`  [调用工具] ${event.toolName}(${JSON.stringify(event.args)})`);
        break;

      case 'tool_response':
        console.log(`  [工具结果] ${event.content}`);
        break;

      case 'usage':
        console.log(
          `  [Token 用量] 输入=${event.usage.inputTokens} 输出=${event.usage.outputTokens}`,
        );
        break;

      case 'error':
        console.error(`  [错误] ${event.message}`);
        break;

      case 'agent_end':
        console.log(`\nAgent 结束 (${event.reason})`);
        break;
    }
  }

  // 展示最终状态
  console.log('\n' + '-'.repeat(40));
  console.log('最终任务列表:');
  for (const t of tasks) {
    console.log(`  #${t.id} [${t.status}] ${t.title} (@${t.assignee})`);
  }

  if (sentNotifications.length > 0) {
    console.log('\n已发送的通知:');
    for (const n of sentNotifications) {
      console.log(`  ${n}`);
    }
  }
}

main().catch(console.error);
