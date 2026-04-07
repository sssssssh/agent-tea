/**
 * 示例 08 — 记忆与持久化（Memory & Persistence）
 *
 * 前置知识：01-basic-agent（Agent 基本用法）
 * 新概念：
 *   - FileConversationStore —— 会话持久化，自动保存/加载完整对话历史
 *   - FileMemoryStore —— 知识级持久化，跨会话的 key-value 知识存取
 *   - 两者的区别：ConversationStore = 聊天记录，MemoryStore = 笔记本
 *
 * 本示例分两部分演示：
 *   Part 1: 会话持久化 —— Agent 运行后对话自动保存，可列出/加载历史会话
 *   Part 2: 知识记忆 —— 通过自定义工具封装 MemoryStore，让 Agent 能"记住"和"回忆"
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/08-memory.ts
 *   OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://your-api.com/v1 MODEL=your-model npx tsx examples/08-memory.ts
 *
 * 运行后会在 .agent-tea/ 目录下生成持久化文件，可多次运行观察会话累积效果。
 */

import {
    Agent,
    tool,
    z,
    FileConversationStore,
    FileMemoryStore,
} from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 初始化两个存储实例
// ============================================================

// 会话存储 —— 保存完整对话记录到 .agent-tea/conversations/
const conversationStore = new FileConversationStore('.agent-tea/conversations');

// 知识存储 —— 保存跨会话知识到 .agent-tea/memory/
const memoryStore = new FileMemoryStore('.agent-tea/memory');

// ============================================================
// 将 MemoryStore 封装为工具，让 Agent 可以读写知识
// ============================================================

// 保存知识 —— Agent 从对话中提取重要信息并记住
const saveMemory = tool(
    {
        name: 'save_memory',
        description: '保存一条知识/偏好到长期记忆中，供后续会话使用',
        parameters: z.object({
            key: z.string().describe('唯一标识，如 "user-preference" 或 "project-tech-stack"'),
            content: z.string().describe('要记住的内容'),
            tags: z
                .array(z.string())
                .optional()
                .describe('分类标签，如 ["preference", "language"]'),
        }),
    },
    async ({ key, content, tags }) => {
        await memoryStore.set(key, content, tags);
        return `已保存知识: [${key}] ${content}`;
    },
);

// 搜索知识 —— Agent 按标签查找相关记忆
const searchMemory = tool(
    {
        name: 'search_memory',
        description: '按标签搜索长期记忆中的知识条目',
        parameters: z.object({
            tags: z.array(z.string()).describe('要搜索的标签列表'),
        }),
    },
    async ({ tags }) => {
        const entries = await memoryStore.search(tags);
        if (entries.length === 0) return '没有找到相关记忆';
        return entries
            .map((e) => `[${e.key}] ${e.content} (标签: ${e.tags?.join(', ') || '无'})`)
            .join('\n');
    },
);

// 获取单条知识 —— Agent 按 key 精确获取
const getMemory = tool(
    {
        name: 'get_memory',
        description: '按 key 获取一条具体的记忆',
        parameters: z.object({
            key: z.string().describe('记忆的唯一标识'),
        }),
    },
    async ({ key }) => {
        const entry = await memoryStore.get(key);
        if (!entry) return { content: `未找到记忆: ${key}`, isError: true };
        return `[${entry.key}] ${entry.content}\n创建于: ${entry.createdAt.toLocaleString('zh-CN')}\n标签: ${entry.tags?.join(', ') || '无'}`;
    },
);

// 列出所有知识 —— Agent 浏览已有记忆
const listMemories = tool(
    {
        name: 'list_memories',
        description: '列出长期记忆中的所有知识条目',
        parameters: z.object({}),
    },
    async () => {
        const entries = await memoryStore.list();
        if (entries.length === 0) return '记忆库为空，还没有保存过任何知识';
        return entries
            .map((e) => `[${e.key}] ${e.content} (标签: ${e.tags?.join(', ') || '无'})`)
            .join('\n');
    },
);

// ============================================================
// 创建 Agent —— 同时配置 conversationStore 和记忆工具
// ============================================================

const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
});

const agent = new Agent({
    provider,
    model: process.env.MODEL || 'gpt-4o-mini',
    tools: [saveMemory, searchMemory, getMemory, listMemories],
    systemPrompt: `你是一个具有长期记忆的智能助手。

你的特殊能力：
1. 你可以将重要信息保存到长期记忆中（save_memory），下次会话还能想起来
2. 你可以搜索和浏览已保存的记忆（search_memory、get_memory、list_memories）

使用策略：
- 当用户告诉你他的偏好、重要信息时，主动保存到记忆中
- 回答问题前，先检查记忆中是否有相关信息
- 用中文回答`,

    // 会话持久化：Agent 运行结束后会自动将对话保存到文件
    conversationStore,
});

// ============================================================
// 主流程
// ============================================================

async function main() {
    const query =
        process.argv[2] ||
        '请先看看你的记忆里有什么，然后记住这些信息：我叫小明，喜欢 TypeScript，正在做一个 AI Agent 项目';

    console.log('='.repeat(60));
    console.log('  记忆与持久化演示');
    console.log('  会话自动保存 + 知识可跨会话保留');
    console.log('='.repeat(60));
    console.log();
    console.log(`用户: ${query}`);
    console.log();

    // ---- 运行 Agent ----
    for await (const event of agent.run(query)) {
        switch (event.type) {
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

    // ============================================================
    // Part 1 演示：展示会话持久化效果
    // ============================================================

    console.log('\n' + '='.repeat(60));
    console.log('  Part 1: 会话持久化效果');
    console.log('='.repeat(60));

    // 列出所有已保存的会话
    const sessions = await conversationStore.list();
    console.log(`\n已保存的会话 (共 ${sessions.length} 个):`);
    for (const session of sessions) {
        console.log(
            `  - ${session.sessionId} (更新于 ${session.metadata.updatedAt.toLocaleString('zh-CN')})`,
        );
    }

    // 加载最新一次会话的消息
    if (sessions.length > 0) {
        const latestSessionId = sessions[0].sessionId;
        const data = await conversationStore.load(latestSessionId);
        if (data) {
            console.log(`\n最新会话 [${latestSessionId}] 包含 ${data.messages.length} 条消息:`);
            // 只展示前几条消息的摘要
            for (const msg of data.messages.slice(0, 4)) {
                const preview =
                    typeof msg.content === 'string' ? msg.content.slice(0, 80) : '[复合内容]';
                console.log(`  [${msg.role}] ${preview}${preview.length >= 80 ? '...' : ''}`);
            }
            if (data.messages.length > 4) {
                console.log(`  ... 还有 ${data.messages.length - 4} 条消息`);
            }
        }
    }

    // ============================================================
    // Part 2 演示：展示知识存储效果
    // ============================================================

    console.log('\n' + '='.repeat(60));
    console.log('  Part 2: 知识记忆效果');
    console.log('='.repeat(60));

    // 列出所有已保存的知识
    const allMemories = await memoryStore.list();
    console.log(`\n知识库中共有 ${allMemories.length} 条记忆:`);
    for (const entry of allMemories) {
        console.log(`  [${entry.key}] ${entry.content}`);
        console.log(
            `    标签: ${entry.tags?.join(', ') || '无'} | 更新于: ${entry.updatedAt.toLocaleString('zh-CN')}`,
        );
    }

    console.log('\n提示: 再次运行此示例，Agent 会从记忆中找到之前保存的信息');
    console.log('存储位置: .agent-tea/conversations/ 和 .agent-tea/memory/');
}

main().catch(console.error);
