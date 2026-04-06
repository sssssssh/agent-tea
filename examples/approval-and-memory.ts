/**
 * 审批系统 + 上下文管理 + 记忆持久化 综合示例
 *
 * Usage:
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/approval-and-memory.ts
 *
 *   # 使用火山引擎 / DeepSeek 等兼容 API：
 *   OPENAI_API_KEY=your-key OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 \
 *   MODEL=your-endpoint-id npx tsx examples/approval-and-memory.ts
 *
 * 演示场景：一个模拟的项目管理助手，具有以下能力：
 * - 查询任务（只读，自动通过）
 * - 创建任务（写操作，需要审批）
 * - 发送通知（不可逆操作，需要审批）
 * - 上下文超长时自动裁剪
 * - 会话结束后自动保存到文件
 */

import * as readline from 'node:readline';
import {
  Agent,
  tool,
  z,
  FileConversationStore,
} from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 模拟数据
// ============================================================

const tasks = [
  { id: 1, title: '完成需求文档', assignee: '张三', status: '进行中' },
  { id: 2, title: '设计数据库 Schema', assignee: '李四', status: '待开始' },
  { id: 3, title: '编写 API 接口', assignee: '王五', status: '待开始' },
];

const notifications: string[] = [];

// ============================================================
// 工具定义
// ============================================================

// 只读工具 —— 不需要审批
const listTasks = tool(
  {
    name: 'list_tasks',
    description: '列出当前所有项目任务',
    parameters: z.object({}),
    tags: ['readonly'],
  },
  async () => {
    return tasks
      .map((t) => `#${t.id} [${t.status}] ${t.title} (@${t.assignee})`)
      .join('\n');
  },
);

const getTask = tool(
  {
    name: 'get_task',
    description: '查询单个任务的详细信息',
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

// 写操作工具 —— 需要审批
const createTask = tool(
  {
    name: 'create_task',
    description: '创建一个新任务',
    parameters: z.object({
      title: z.string().describe('任务标题'),
      assignee: z.string().describe('负责人姓名'),
    }),
    tags: ['write'],
  },
  async ({ title, assignee }) => {
    const newId = tasks.length + 1;
    const task = { id: newId, title, assignee, status: '待开始' };
    tasks.push(task);
    return `已创建任务 #${newId}: ${title} (@${assignee})`;
  },
);

// 不可逆操作 —— 需要审批
const sendNotification = tool(
  {
    name: 'send_notification',
    description: '给团队成员发送通知消息（不可撤回）',
    parameters: z.object({
      to: z.string().describe('接收人姓名'),
      message: z.string().describe('通知内容'),
    }),
    tags: ['write', 'irreversible'],
  },
  async ({ to, message }) => {
    const notification = `[通知] → ${to}: ${message}`;
    notifications.push(notification);
    return `通知已发送给 ${to}`;
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
  tools: [listTasks, getTask, createTask, sendNotification],
  systemPrompt: `你是一个项目管理助手。你可以帮用户查看、创建任务，以及给团队成员发送通知。
用中文回答。操作前先确认用户的意图。`,

  // 审批策略：带 'write' 标签的工具需要用户确认
  approvalPolicy: {
    mode: 'tagged',
    requireApprovalTags: ['write'],
  },

  // 上下文管理：粗略限制在 4000 token（演示用，实际可设更大）
  contextManager: {
    maxTokens: 4000,
  },

  // 会话持久化：保存到 .t-agent/conversations/
  conversationStore: new FileConversationStore(),
});

// ============================================================
// 用户交互
// ============================================================

/** 简单的命令行交互式审批 */
function askUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y') || answer === '');
    });
  });
}

async function main() {
  const query =
    process.argv[2] ||
    '帮我看看现在有哪些任务，然后创建一个新任务"部署测试环境"分配给赵六，最后通知赵六他有新任务了';

  console.log('╔════════════════════════════════════════╗');
  console.log('║  项目管理助手（审批 + 记忆 演示）      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log();
  console.log(`> ${query}`);
  console.log();

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'approval_request':
        // 收到审批请求，展示给用户并等待确认
        console.log();
        console.log(`⚠️  需要确认：${event.toolName}`);
        console.log(`   参数: ${JSON.stringify(event.args, null, 2)}`);
        console.log(`   说明: ${event.toolDescription}`);

        const approved = await askUser('   确认执行？(Y/n) ');
        agent.resolveApproval(event.requestId, {
          approved,
          reason: approved ? undefined : '用户拒绝了此操作',
        });

        console.log(approved ? '   ✅ 已批准' : '   ❌ 已拒绝');
        console.log();
        break;

      case 'message':
        console.log(`🤖 ${event.content}`);
        break;

      case 'tool_request':
        console.log(`   🔧 调用 ${event.toolName}(${JSON.stringify(event.args)})`);
        break;

      case 'tool_response':
        console.log(`   📋 ${event.content}`);
        break;

      case 'usage':
        console.log(
          `   📊 Tokens: in=${event.usage.inputTokens} out=${event.usage.outputTokens}`,
        );
        break;

      case 'error':
        console.error(`   ❗ ${event.message}`);
        break;

      case 'agent_end':
        console.log();
        console.log(`✅ Agent 结束 (${event.reason})`);
        break;
    }
  }

  // 展示效果
  if (notifications.length > 0) {
    console.log('\n--- 已发送的通知 ---');
    for (const n of notifications) {
      console.log(n);
    }
  }

  console.log('\n--- 当前任务列表 ---');
  for (const t of tasks) {
    console.log(`#${t.id} [${t.status}] ${t.title} (@${t.assignee})`);
  }

  console.log('\n💾 会话已保存到 .t-agent/conversations/');
}

main().catch(console.error);
