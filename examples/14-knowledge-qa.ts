/**
 * 14-knowledge-qa.ts —— 知识问答 Agent 综合示例
 *
 * 前置知识：
 *   - 02-xxx（内置工具概念）
 *   - 06-xxx（上下文管理概念）
 *   - 07-xxx（审批系统概念）
 *   - 08-xxx（记忆系统概念）
 *
 * 新概念：
 *   无新概念 —— 这是一个综合运用示例，将以下子系统串联：
 *   - 内置工具（readFile, grep, listDirectory）读取项目文档
 *   - FileMemoryStore 存储已学习的知识点
 *   - PipelineContextManager 组合多个处理器防止长对话超限
 *   - 审批系统控制"写入记忆"操作
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/14-knowledge-qa.ts
 *
 * 场景说明：
 *   知识问答 Agent 可以阅读项目文件、提取知识存入记忆、从记忆中回忆信息。
 *   - readFile / grep / listDirectory：读取项目文件（内置工具）
 *   - remember（自定义，tags: ['write']）：存储知识点到 FileMemoryStore
 *   - recall（自定义，tags: ['readonly']）：从记忆中搜索知识点
 *   写入记忆需要用户审批，读取记忆不需要。
 *   PipelineContextManager 确保长对话不会超出 token 限制。
 */

import * as readline from 'node:readline';
import {
  Agent,
  tool,
  z,
  FileMemoryStore,
  SlidingWindowProcessor,
  ToolOutputTruncator,
  readFile,
  grep,
  listDirectory,
} from '../packages/sdk/src/index.js';
import type { AgentEvent } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 记忆存储初始化
// ============================================================

/**
 * FileMemoryStore —— 基于文件的知识记忆。
 * 每条记忆是一个 key-value 对，可以带标签用于搜索。
 * 存储在 .t-agent/memory/ 目录下的 JSON 文件中。
 */
const memoryStore = new FileMemoryStore('.t-agent/memory');

// ============================================================
// 自定义工具：remember 和 recall
// ============================================================

/**
 * 存储知识到记忆中。
 * 标记为 ['write'] 标签，在审批策略下需要用户确认。
 * 这样可以防止 Agent 存储不正确或不需要的信息。
 */
const remember = tool(
  {
    name: 'remember',
    description: '将一条知识点保存到长期记忆中。保存后可以在后续对话中通过 recall 工具检索。',
    parameters: z.object({
      key: z.string().describe('知识点的唯一标识，如 "project-architecture" 或 "api-design-pattern"'),
      content: z.string().describe('要记住的知识内容，尽量精炼准确'),
      tags: z.array(z.string()).optional().describe('分类标签，如 ["architecture", "design"]，便于后续搜索'),
    }),
    tags: ['write'], // 写入操作，需要审批
  },
  async ({ key, content, tags }) => {
    await memoryStore.set(key, content, tags);
    return `已将知识点 "${key}" 保存到记忆中${tags ? `（标签: ${tags.join(', ')}）` : ''}`;
  },
);

/**
 * 从记忆中搜索知识。
 * 标记为 ['readonly'] 标签，不需要审批。
 */
const recall = tool(
  {
    name: 'recall',
    description: '从长期记忆中搜索已保存的知识点。可以按标签过滤，也可以列出所有记忆。',
    parameters: z.object({
      tags: z.array(z.string()).optional().describe('按标签搜索，如 ["architecture"]。不传则列出所有记忆。'),
    }),
    tags: ['readonly'],
  },
  async ({ tags }) => {
    const entries = await memoryStore.search(tags);

    if (entries.length === 0) {
      return '记忆中没有找到匹配的知识点。建议用 readFile 或 grep 工具直接查看项目文件。';
    }

    // 格式化记忆条目
    const formatted = entries.map((entry) => {
      const tagStr = entry.tags?.length ? ` [${entry.tags.join(', ')}]` : '';
      const timeStr = entry.updatedAt.toLocaleString('zh-CN');
      return `--- ${entry.key}${tagStr} (更新于 ${timeStr}) ---\n${entry.content}`;
    });

    return formatted.join('\n\n');
  },
);

// ============================================================
// 上下文管理器配置
// ============================================================

/**
 * 上下文管理器配置 —— 使用管道（pipeline）策略。
 *
 * 通过 AgentConfig.contextManager 传入配置，框架会自动创建 PipelineContextManager。
 * strategy: 'pipeline' 启用管道模式，processors 中的处理器按顺序执行：
 *
 * 处理顺序：
 * 1. ToolOutputTruncator —— 先截断过长的工具输出（如大文件内容）
 * 2. SlidingWindowProcessor —— 再做滑动窗口裁剪，保留最近的对话
 *
 * 这种组合确保即使 Agent 读取了很多大文件，对话也不会超出 token 限制。
 */
const contextManagerConfig = {
  maxTokens: 8000, // 总 token 预算
  strategy: 'pipeline' as const,
  processors: [
    // 截断超过 500 字符的工具输出，防止大文件内容占满上下文
    new ToolOutputTruncator({ maxOutputLength: 500 }),
    // 滑动窗口：保留前 2 条消息（system prompt 相关）和最近的消息
    new SlidingWindowProcessor({ reservedMessageCount: 2 }),
  ],
};

// ============================================================
// 用户交互辅助
// ============================================================

function askUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer === '' || answer.toLowerCase().startsWith('y'));
    });
  });
}

// ============================================================
// 创建 Agent
// ============================================================

const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  }),
  model: process.env.MODEL || 'gpt-4o-mini',

  tools: [
    // 内置文件操作工具（只读）
    readFile,
    grep,
    listDirectory,
    // 自定义记忆工具
    remember,
    recall,
  ],

  systemPrompt: `你是一个项目知识问答助手。你的工作流程：

1. 收到问题后，先用 recall 工具检查记忆中是否有相关知识
2. 如果记忆中没有，用 listDirectory / grep / readFile 工具查看项目文件
3. 提取关键信息后，用 remember 工具保存到记忆中（以便后续快速回答）
4. 根据收集到的信息回答用户问题

注意事项：
- 优先使用 grep 搜索关键词，定位到具体文件后再用 readFile 精读
- readFile 读取大文件时只读需要的部分（用 offset 和 limit 参数）
- 存储记忆时 key 要有意义，content 要精炼，tags 要分类合理
- 用中文回答`,

  // 审批策略：带 'write' 标签的工具需要用户确认
  approvalPolicy: {
    mode: 'tagged',
    requireApprovalTags: ['write'],
  },

  // 上下文管理：管道模式，防止长对话超限
  contextManager: contextManagerConfig,

  maxIterations: 12,
});

// ============================================================
// 事件消费函数
// ============================================================

async function consumeEvents(events: AsyncGenerator<AgentEvent>) {
  for await (const event of events) {
    switch (event.type) {
      case 'message':
        console.log(`\n[Assistant] ${event.content}`);
        break;

      case 'tool_request':
        console.log(`  -> ${event.toolName}(${JSON.stringify(event.args).slice(0, 120)}${JSON.stringify(event.args).length > 120 ? '...' : ''})`);
        break;

      case 'tool_response':
        if (event.isError) {
          console.log(`  <- [错误] ${event.content}`);
        } else {
          // 截断过长的工具输出
          const display = event.content.length > 200
            ? event.content.slice(0, 200) + `... (共 ${event.content.length} 字符)`
            : event.content;
          console.log(`  <- ${display}`);
        }
        break;

      case 'approval_request':
        // 写入记忆的审批
        console.log();
        console.log(`  [审批请求] ${event.toolName}`);
        console.log(`  参数: ${JSON.stringify(event.args, null, 2)}`);

        const approved = await askUser('  确认存储到记忆？(Y/n) ');
        agent.resolveApproval(event.requestId, {
          approved,
          reason: approved ? undefined : '用户不希望存储此信息到记忆',
        });

        console.log(approved ? '  -> 已批准' : '  -> 已拒绝');
        break;

      case 'usage':
        console.log(`  [Token] in=${event.usage.inputTokens} out=${event.usage.outputTokens}`);
        break;

      case 'error':
        console.error(`  [错误] ${event.fatal ? '致命: ' : ''}${event.message}`);
        break;

      case 'agent_end':
        console.log(`\n[结束] 原因: ${event.reason}`);
        break;
    }
  }
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('  知识问答 Agent');
  console.log('  (内置工具 + 记忆 + 上下文管理 + 审批)');
  console.log('='.repeat(60));
  console.log();
  console.log('功能说明:');
  console.log('  - 读取项目文件回答技术问题');
  console.log('  - 自动将知识点存入记忆（需要你审批）');
  console.log('  - 后续提问优先从记忆中检索');
  console.log('  - 上下文管理防止长对话超出 token 限制');
  console.log();

  // 第一轮对话：阅读 README 并提取知识
  const query1 = process.argv[2] || '这个项目是做什么的？请阅读 README.md 了解后告诉我';
  console.log(`> ${query1}`);
  await consumeEvents(agent.run(query1));

  console.log('\n' + '-'.repeat(60) + '\n');

  // 第二轮对话：利用记忆快速回答
  const query2 = '这个项目用了什么技术栈？';
  console.log(`> ${query2}`);
  console.log('  (如果第一轮已存入记忆，这次会优先从记忆中检索)');
  await consumeEvents(agent.run(query2));

  // 展示记忆内容
  console.log('\n' + '='.repeat(60));
  console.log('  当前记忆内容');
  console.log('='.repeat(60));

  const memories = await memoryStore.list();
  if (memories.length === 0) {
    console.log('  (记忆为空)');
  } else {
    for (const entry of memories) {
      const tagStr = entry.tags?.length ? ` [${entry.tags.join(', ')}]` : '';
      console.log(`\n  ${entry.key}${tagStr}`);
      console.log(`  ${entry.content.slice(0, 200)}${entry.content.length > 200 ? '...' : ''}`);
    }
  }

  console.log('\n  记忆文件保存在: .t-agent/memory/');
}

main().catch(console.error);
