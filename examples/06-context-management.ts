/**
 * 06 - 上下文管理：控制对话长度，防止超出 LLM 窗口限制
 *
 * 前置知识：01-hello-agent（Agent、tool 基础）
 *
 * 本示例新概念：
 * - ContextManager：在每次 LLM 调用前自动裁剪消息，确保不超 token 预算
 * - 方式 1（简单配置）：通过 AgentConfig.contextManager 设置 maxTokens
 * - 方式 2（Pipeline 管道）：组合多个处理器，精细控制裁剪行为
 * - SlidingWindowProcessor：滑动窗口策略，保留头尾、丢弃中间
 * - ToolOutputTruncator：截断过长的工具输出，头尾保留
 * - createContextManager()：根据配置创建 ContextManager 实例
 *
 * 运行方式：
 *   # 方式 1（简单配置，默认）
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/06-context-management.ts simple
 *
 *   # 方式 2（Pipeline 管道）
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/06-context-management.ts pipeline
 */

import {
    Agent,
    tool,
    z,
    SlidingWindowProcessor,
    ToolOutputTruncator,
} from '../packages/sdk/src/index.js';
import type { ContextManagerConfig } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 定义一个会产生长输出的工具 —— 用来触发上下文裁剪
// ============================================================

/** 生成一段指定长度的中文文本 */
function generateLongText(length: number): string {
    const paragraphs = [
        '这是一段很长的文本内容，用于演示上下文管理的裁剪行为。当对话历史积累到一定长度时，框架会自动裁剪早期的消息。',
        '上下文管理的核心目标是：在不丢失关键信息的前提下，让对话历史始终保持在 LLM 的上下文窗口限制内。',
        '滑动窗口策略保留最早的几条消息（通常是任务上下文）和最新的消息，中间的历史会被截断并插入标记。',
        '工具输出截断器则专门处理工具返回的超长内容，采用头尾保留策略，因为头部通常包含摘要，尾部包含最新结果。',
        '通过管道模式组合多个处理器，可以实现精细的裁剪策略：先截断工具输出，再做滑动窗口裁剪。',
    ];

    let result = '';
    while (result.length < length) {
        const idx = Math.floor(Math.random() * paragraphs.length);
        result += paragraphs[idx] + '\n';
    }
    return result.slice(0, length);
}

const readLargeFile = tool(
    {
        name: 'read_large_file',
        description: '读取一个大文件的内容（模拟）',
        parameters: z.object({
            filename: z.string().describe('文件名'),
        }),
    },
    async ({ filename }) => {
        // 模拟返回长文本，触发上下文裁剪
        const content = generateLongText(2000);
        return `文件 ${filename} 的内容：\n${content}`;
    },
);

const summarize = tool(
    {
        name: 'summarize',
        description: '对文本进行摘要',
        parameters: z.object({
            text: z.string().describe('要摘要的文本'),
        }),
    },
    async ({ text }) => {
        return `摘要（${text.length} 字 → 30 字）：这是对输入文本的简要总结。`;
    },
);

// ============================================================
// 方式 1：简单配置
// 通过 AgentConfig.contextManager 字段设置 maxTokens，
// 框架内部自动创建 SlidingWindowProcessor 进行裁剪。
//
// 这是最简单的使用方式，适合大多数场景。
// ============================================================

const simpleConfig: ContextManagerConfig = {
    // 设置较小的 token 预算以便观察裁剪效果（实际使用建议设为模型窗口的 80%）
    maxTokens: 2000,
    // 始终保留最早的 2 条消息（系统提示 + 第一条用户消息），默认为 1
    reservedMessageCount: 2,
};

// ============================================================
// 方式 2：Pipeline 管道配置
// 手动组合多个处理器，消息按顺序经过每个处理器。
//
// 处理顺序很重要：
// 1. ToolOutputTruncator 先截断超长的工具输出
// 2. SlidingWindowProcessor 再对整体消息列表做滑动窗口裁剪
//
// 这样避免了先裁掉重要消息、却保留了超长工具输出的问题。
// ============================================================

const pipelineConfig: ContextManagerConfig = {
    maxTokens: 2000,
    strategy: 'pipeline',
    processors: [
        // 第一步：截断工具输出
        // maxOutputLength: 超过 500 字符的工具输出会被截断（头 30% + 尾 30%，中间省略）
        // protectedTurns: 最近 1 轮的工具输出不截断（最新结果最重要）
        new ToolOutputTruncator({
            maxOutputLength: 500,
            protectedTurns: 1,
        }),
        // 第二步：滑动窗口裁剪
        // reservedMessageCount: 保留最早的 2 条消息
        new SlidingWindowProcessor({
            reservedMessageCount: 2,
        }),
    ],
};

// ============================================================
// 运行 Agent
// ============================================================

async function main() {
    const mode = process.argv[2] || 'simple';
    const contextManagerConfig = mode === 'pipeline' ? pipelineConfig : simpleConfig;

    console.log(`上下文管理模式: ${mode === 'pipeline' ? 'Pipeline 管道' : '简单配置'}`);
    console.log(`Token 预算: ${contextManagerConfig.maxTokens}`);
    if (mode === 'pipeline') {
        console.log('处理器管道: ToolOutputTruncator → SlidingWindowProcessor');
    }
    console.log();

    const provider = new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
    });

    const agent = new Agent({
        provider,
        model: process.env.MODEL || 'gpt-4o-mini',
        tools: [readLargeFile, summarize],
        systemPrompt: `你是一个文件分析助手。用中文回答。
当用户要求分析文件时，先用 read_large_file 读取，然后用 summarize 做摘要。`,
        // 将上下文管理配置传给 Agent
        contextManager: contextManagerConfig,
    });

    // 设计一个需要多次工具调用的问题，积累足够多的消息来触发裁剪
    const query = '帮我依次读取 report-q1.txt、report-q2.txt 和 report-q3.txt，然后分别做摘要';
    console.log(`> ${query}\n`);

    // 跟踪消息数量的变化
    let messageEventCount = 0;
    let toolResponseCount = 0;

    for await (const event of agent.run(query)) {
        switch (event.type) {
            case 'message':
                messageEventCount++;
                console.log(`[助手] ${event.content}`);
                break;

            case 'tool_request':
                console.log(`[工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
                break;

            case 'tool_response': {
                toolResponseCount++;
                // 展示截断后的长度，以观察上下文管理效果
                const preview =
                    event.content.length > 100
                        ? event.content.slice(0, 100) + `... (共 ${event.content.length} 字符)`
                        : event.content;
                console.log(`[工具结果] ${preview}`);
                break;
            }

            case 'usage':
                console.log(
                    `[用量] 输入=${event.usage.inputTokens} 输出=${event.usage.outputTokens}`,
                );
                break;

            case 'state_change':
                console.log(`[状态] ${event.from} → ${event.to}`);
                break;

            case 'error':
                console.error(`[错误] ${event.fatal ? '致命' : '可恢复'}: ${event.message}`);
                break;

            case 'agent_end':
                console.log(`[结束] ${event.reason}`);
                break;
        }
    }

    console.log(`\n--- 统计 ---`);
    console.log(`助手消息: ${messageEventCount} 条`);
    console.log(`工具响应: ${toolResponseCount} 次`);
    console.log(`\n提示：对比 simple 和 pipeline 模式下的 token 用量差异，`);
    console.log(`pipeline 模式通过先截断工具输出，可以更有效地控制上下文大小。`);

    console.log('\n完成。');
}

main().catch(console.error);
