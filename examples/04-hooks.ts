/**
 * 04 - 生命周期钩子：在 Agent 运行的关键节点注入自定义逻辑
 *
 * 前置知识：
 * - 01-hello-agent（Agent、tool 基础）
 * - 03-event-stream（事件流和状态机概念）
 *
 * 本示例新概念：
 * - onBeforeToolCall / onAfterToolCall：工具调用前后拦截
 * - onBeforeIteration / onAfterIteration：迭代（LLM 调用 + 工具执行）前后拦截
 * - 通过子类化 ReActAgent 来覆写钩子方法
 * - ToolCallDecision：控制是否允许工具执行，或修改参数
 * - IterationContext：迭代上下文，包含当前轮次、消息历史等
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/04-hooks.ts
 *
 *   # 自定义问题：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/04-hooks.ts "现在几点？然后算 42 * 58"
 */

import { ReActAgent, tool, z } from '../packages/sdk/src/index.js';
import type { ToolCallDecision, IterationContext, ToolResult } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 定义两个工具，让 Agent 需要多步操作来触发多次钩子
// ============================================================

const calculator = tool(
    {
        name: 'calculate',
        description: '计算数学表达式',
        parameters: z.object({
            expression: z.string().describe('数学表达式，如 "2 + 3 * 4"'),
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

const getTime = tool(
    {
        name: 'get_current_time',
        description: '获取当前日期和时间',
        parameters: z.object({}),
    },
    async () => {
        return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    },
);

// ============================================================
// 通过子类化 ReActAgent 来覆写钩子方法
//
// 钩子是 BaseAgent 上的 protected 方法，设计上需要子类化来覆写。
// 这种模式适合需要深度定制 Agent 行为的场景（如日志、审计、限流等）。
//
// 四个核心钩子：
// - onBeforeIteration(ctx)：每轮 LLM 调用前触发
// - onAfterIteration(ctx)：每轮 LLM 调用后触发
// - onBeforeToolCall(name, args)：每次工具执行前触发，返回 ToolCallDecision
// - onAfterToolCall(name, result)：每次工具执行后触发
// ============================================================

/** 工具调用计时器，用于记录每个工具的执行耗时 */
const toolTimers = new Map<string, number>();

class InstrumentedAgent extends ReActAgent {
    /**
     * 迭代前钩子
     * IterationContext 包含：
     *   - iteration: 当前轮次编号（从 0 开始）
     *   - messages: 当前消息历史（只读）
     *   - sessionId: 本次运行的会话 ID
     *   - state: 当前 Agent 状态
     */
    protected override async onBeforeIteration(ctx: IterationContext): Promise<void> {
        console.log(`\n--- 第 ${ctx.iteration + 1} 轮迭代开始 (状态: ${ctx.state}) ---`);
    }

    /**
     * 迭代后钩子
     * 此时 LLM 已经返回响应，工具也已经执行完毕（如果有的话）
     */
    protected override async onAfterIteration(ctx: IterationContext): Promise<void> {
        console.log(
            `--- 第 ${ctx.iteration + 1} 轮迭代结束 (消息数: ${ctx.messages.length}) ---\n`,
        );
    }

    /**
     * 工具调用前钩子
     * 返回 ToolCallDecision：
     *   - { allow: true }：允许执行
     *   - { allow: true, modifiedArgs: {...} }：允许执行但修改参数
     *   - { allow: false }：拒绝执行（LLM 会收到拒绝提示）
     */
    protected override async onBeforeToolCall(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<ToolCallDecision> {
        console.log(`  >> 即将调用 ${toolName}，参数: ${JSON.stringify(args)}`);
        // 记录开始时间
        toolTimers.set(toolName, Date.now());
        // 允许所有工具调用
        return { allow: true };
    }

    /**
     * 工具调用后钩子
     * result 是 ToolResult { content: string, isError?: boolean }
     */
    protected override async onAfterToolCall(toolName: string, result: ToolResult): Promise<void> {
        const startTime = toolTimers.get(toolName);
        const elapsed = startTime ? Date.now() - startTime : 0;
        const status = result.isError ? '失败' : '成功';
        console.log(`  << 调用完成 ${toolName} [${status}]，耗时 ${elapsed}ms`);
    }
}

// ============================================================
// 创建带钩子的 Agent 并运行
// ============================================================

const agent = new InstrumentedAgent({
    provider: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
    }),
    model: process.env.MODEL || 'gpt-4o-mini',
    tools: [calculator, getTime],
    systemPrompt:
        '你是一个有用的助手。用中文回答问题。需要计算时用 calculate 工具，需要时间信息时用 get_current_time 工具。',
});

async function main() {
    const query = process.argv[2] || '现在几点了？然后帮我算一下 123 * 456 和 789 + 321';
    console.log(`> ${query}\n`);

    for await (const event of agent.run(query)) {
        switch (event.type) {
            case 'message':
                console.log(`[助手] ${event.content}`);
                break;

            case 'tool_request':
                // 钩子的日志会在 tool_request 事件之前/之后打印
                console.log(`[工具调用] ${event.toolName}`);
                break;

            case 'tool_response':
                console.log(`[工具结果] ${event.content}`);
                break;

            case 'error':
                console.error(`[错误] ${event.message}`);
                break;
        }
    }

    console.log('\n完成。');
}

main().catch(console.error);
