/**
 * 15-dev-assistant.ts —— 研发助手（全功能综合示例）
 *
 * 前置知识：
 *   全部前面的示例（01-14）
 *
 * 新概念：
 *   无新概念 —— 综合运用框架所有核心功能：
 *   - PlanAndExecuteAgent —— 先规划后执行
 *   - SubAgent —— 委派代码搜索子任务
 *   - Extension (builtinTools) —— 提供文件操作工具
 *   - 审批系统 —— 文件写入需确认
 *   - 循环检测 —— 防止 Agent 死循环
 *   - 上下文管理 —— Pipeline 处理器组合
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/15-dev-assistant.ts
 *
 * 场景说明：
 *   模拟代码审查流程：
 *   1. 用户提交代码审查请求
 *   2. Agent 规划审查步骤（读代码、找问题、写报告）
 *   3. 用户确认计划
 *   4. Agent 逐步执行，搜索任务委派给子 Agent
 *   5. 写文件（审查报告）需要用户审批
 */

import * as readline from 'node:readline';
import {
    PlanAndExecuteAgent,
    subAgent,
    builtinTools,
    tool,
    z,
    SlidingWindowProcessor,
    ToolOutputTruncator,
} from '../packages/sdk/src/index.js';
import type {
    Plan,
    PlanApproval,
    PlanStep,
    StepResult,
    StepFailureAction,
    AgentEvent,
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
// 内置工具扩展
// ============================================================

/**
 * builtinTools 是 SDK 提供的预打包扩展，包含：
 * - readFile / writeFile / listDirectory / executeShell / grep / webFetch
 *
 * 通过 builtinTools.tools 获取工具数组，
 * 通过 builtinTools.instructions 获取使用说明（可注入 systemPrompt）。
 */
const fileTools = builtinTools.tools ?? [];
const fileInstructions = builtinTools.instructions ?? '';

// ============================================================
// 子 Agent：代码搜索专家
// ============================================================

/**
 * 代码搜索子 Agent —— 将 ReActAgent 包装为一个 Tool。
 *
 * 当主 Agent 需要在代码库中搜索特定模式或关键词时，
 * 委派给这个子 Agent。子 Agent 有自己的工具集（grep + readFile），
 * 对主 Agent 来说就是一个普通的工具调用。
 *
 * 好处：
 * - 子 Agent 有独立的上下文，不会污染主 Agent 的对话历史
 * - 搜索多个文件时只返回最终摘要，节省主 Agent 的 token
 * - 可以使用更便宜的模型执行搜索任务
 */
const codeSearcher = subAgent({
    name: 'search_code',
    description:
        '在代码库中搜索特定模式、关键词或代码结构。返回搜索结果的摘要。适合需要跨多个文件查找信息的任务。',
    provider,
    model,
    tools: fileTools.filter((t) => ['grep', 'read_file', 'list_directory'].includes(t.name)),
    systemPrompt: `你是代码搜索专家。你的工作流程：
1. 用 grep 搜索匹配的文件和行
2. 用 read_file 查看具体文件内容（只读需要的部分）
3. 整理搜索结果为清晰的摘要

注意事项：
- 搜索时先用 grep 缩小范围，不要直接读整个文件
- 摘要要包含：文件路径、匹配行号、关键代码片段
- 用中文给出摘要`,
    maxIterations: 8,
});

// ============================================================
// 自定义工具：写审查报告
// ============================================================

/**
 * 写入审查报告到文件。
 * 标记为 ['write'] 标签，需要用户审批。
 * 标记为 ['filesystem'] 便于后续过滤。
 */
const writeReport = tool(
    {
        name: 'write_review_report',
        description: '将代码审查报告写入文件。内容会覆盖已有文件。',
        parameters: z.object({
            filePath: z.string().describe('报告文件路径，如 ./review-report.md'),
            content: z.string().describe('审查报告内容（Markdown 格式）'),
        }),
        tags: ['write', 'filesystem'],
    },
    async ({ filePath, content }) => {
        // 使用 node:fs 写入文件
        const fs = await import('node:fs/promises');
        const path = await import('node:path');

        const absPath = path.resolve(filePath);
        const dir = path.dirname(absPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(absPath, content, 'utf-8');

        return `审查报告已写入: ${absPath} (${content.length} 字符)`;
    },
);

/**
 * 只读工具：获取 git 提交历史摘要。
 * 规划阶段可用，帮助 Agent 了解最近的变更。
 */
const getGitLog = tool(
    {
        name: 'get_git_log',
        description: '获取最近的 git 提交记录',
        parameters: z.object({
            count: z.number().optional().describe('获取的提交数量，默认 5'),
        }),
        tags: ['readonly'],
    },
    async ({ count }) => {
        const n = count ?? 5;
        try {
            const { execSync } = await import('node:child_process');
            const log = execSync(`git log --oneline -n ${n}`, { encoding: 'utf-8' });
            return log.trim() || '没有找到 git 提交记录';
        } catch {
            return '无法执行 git log，可能不在 git 仓库中';
        }
    },
);

/**
 * 只读工具：获取 git diff 摘要。
 * 规划阶段可用，帮助 Agent 了解有哪些文件被修改。
 */
const getGitDiff = tool(
    {
        name: 'get_git_diff',
        description: '获取当前未提交的文件变更列表',
        parameters: z.object({}),
        tags: ['readonly'],
    },
    async () => {
        try {
            const { execSync } = await import('node:child_process');
            const diff = execSync('git diff --stat', { encoding: 'utf-8' });
            const staged = execSync('git diff --cached --stat', { encoding: 'utf-8' });

            let result = '';
            if (diff.trim()) result += `未暂存的变更:\n${diff.trim()}\n\n`;
            if (staged.trim()) result += `已暂存的变更:\n${staged.trim()}`;
            return result.trim() || '没有未提交的变更';
        } catch {
            return '无法执行 git diff，可能不在 git 仓库中';
        }
    },
);

// ============================================================
// 上下文管理器
// ============================================================

/**
 * 上下文管理器配置 —— 管道模式：
 * 1. ToolOutputTruncator: 截断过长的代码搜索结果
 * 2. SlidingWindowProcessor: 保留最近的对话，裁剪过早的消息
 *
 * 通过 AgentConfig.contextManager 传入，框架自动创建 PipelineContextManager 实例。
 */
const contextManagerConfig = {
    maxTokens: 12000,
    strategy: 'pipeline' as const,
    processors: [
        new ToolOutputTruncator({ maxOutputLength: 800 }),
        new SlidingWindowProcessor({ reservedMessageCount: 3 }),
    ],
};

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
// 自定义 PlanAndExecuteAgent 子类
// ============================================================

class DevAssistant extends PlanAndExecuteAgent {
    /** 计划创建后展示给用户并等待确认 */
    protected override async onPlanCreated(plan: Plan): Promise<PlanApproval> {
        console.log('\n' + '='.repeat(60));
        console.log('  代码审查计划');
        console.log('='.repeat(60));
        plan.steps.forEach((step, i) => {
            console.log(`  ${i + 1}. ${step.description}`);
        });
        console.log('='.repeat(60));

        const answer = await askUser('\n确认执行此审查计划？(Y/n) ');
        const approved = answer === '' || answer.toLowerCase().startsWith('y');

        if (!approved) {
            const feedback = await askUser('请说明调整意见（直接回车跳过）: ');
            return {
                approved: false,
                feedback: feedback || '用户取消了此计划，请根据用户意见调整',
            };
        }

        return { approved: true };
    }

    /** 步骤开始时打印进度 */
    protected override async onStepStart(step: PlanStep): Promise<void> {
        console.log(`\n${'*'.repeat(50)}`);
        console.log(`  [步骤 ${step.index + 1}] ${step.description}`);
        console.log('*'.repeat(50));
    }

    /** 步骤完成时打印结果 */
    protected override async onStepComplete(step: PlanStep, result: StepResult): Promise<void> {
        console.log(`  [步骤 ${step.index + 1} 完成] 工具调用 ${result.toolCallCount} 次`);
    }

    /** 步骤失败时让用户选择策略 */
    protected override async onStepFailed(
        step: PlanStep,
        error: Error,
    ): Promise<StepFailureAction> {
        console.log(`\n  [步骤 ${step.index + 1} 失败] ${error.message}`);
        console.log('  选择: (1) abort  (2) skip  (3) replan');

        const choice = await askUser('  请选择 (1/2/3，默认 1): ');
        const map: Record<string, StepFailureAction> = { '2': 'skip', '3': 'replan' };
        return map[choice] ?? 'abort';
    }
}

// ============================================================
// 组装所有工具（区分只读和写操作）
// ============================================================

/**
 * 工具列表说明：
 *
 * 只读工具（tags: ['readonly']）—— 规划阶段可用：
 * - getGitLog: 查看提交历史
 * - getGitDiff: 查看变更文件
 * - listDirectory / grep / readFile: 文件浏览（来自 builtinTools）
 *
 * 搜索子 Agent —— 执行阶段可用：
 * - search_code: 委派给子 Agent 执行跨文件搜索
 *
 * 写操作工具（tags: ['write']）—— 执行阶段可用，需审批：
 * - write_review_report: 写入审查报告文件
 */

// 从 builtinTools 中取出只读工具，添加 readonly 标签
// 注意：原始的 builtinTools 工具没有 tags，这里需要包装
const readOnlyBuiltins = fileTools
    .filter((t) => ['read_file', 'grep', 'list_directory'].includes(t.name))
    .map((t) => {
        // 为内置只读工具添加 readonly 标签
        return tool(
            {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
                tags: [...(t.tags ?? []), 'readonly'],
            },
            // 复用原始工具的 execute 函数
            async (params, context) => {
                const result = await t.execute(params, context);
                return typeof result === 'string' ? result : result.content;
            },
        );
    });

const allTools = [
    // 只读工具（规划阶段可用）
    ...readOnlyBuiltins,
    getGitLog,
    getGitDiff,
    // 代码搜索子 Agent（执行阶段）
    codeSearcher,
    // 写操作工具（执行阶段，需审批）
    writeReport,
];

// ============================================================
// 创建 Agent 实例
// ============================================================

const agent = new DevAssistant({
    provider,
    model,
    tools: allTools,

    systemPrompt: `你是一个研发助手，专门做代码审查。

${fileInstructions}

工作流程：
1. 规划阶段：用只读工具了解代码变更（get_git_log, get_git_diff, list_directory, grep, read_file）
2. 制定审查计划，每步一行，用编号列表格式输出
3. 等待用户确认计划
4. 执行阶段：
   - 需要跨文件搜索时使用 search_code（子 Agent 会自动处理）
   - 需要精读代码时直接用 read_file
   - 审查完成后用 write_review_report 生成审查报告

审查要点：
- 代码质量（命名、结构、可读性）
- 潜在 bug（边界条件、错误处理）
- 性能问题
- 类型安全
- 测试覆盖

报告格式要求（Markdown）：
- 标题 + 审查概述
- 按文件列出发现的问题（严重程度标注）
- 改进建议
- 总体评价

用中文输出。`,

    planStoreDir: '.agent-tea/plans',
    maxIterations: 15,

    // 审批策略：带 'write' 标签的工具需确认
    approvalPolicy: {
        mode: 'tagged',
        requireApprovalTags: ['write'],
    },

    // 循环检测：防止 Agent 在搜索文件时死循环
    loopDetection: {
        enabled: true,
        maxConsecutiveIdenticalCalls: 3,
        maxWarnings: 1,
    },

    // 上下文管理：管道模式处理长对话
    contextManager: contextManagerConfig,
});

// ============================================================
// 事件消费
// ============================================================

async function consumeEvents(events: AsyncGenerator<AgentEvent>) {
    for await (const event of events) {
        switch (event.type) {
            // ---- 基础事件 ----
            case 'message':
                console.log(`\n[Assistant] ${event.content}`);
                break;

            case 'tool_request':
                console.log(
                    `  -> ${event.toolName}(${JSON.stringify(event.args).slice(0, 100)}${JSON.stringify(event.args).length > 100 ? '...' : ''})`,
                );
                break;

            case 'tool_response':
                if (event.isError) {
                    console.log(`  <- [错误] ${event.content}`);
                } else {
                    const display =
                        event.content.length > 200
                            ? event.content.slice(0, 200) + `... (共 ${event.content.length} 字符)`
                            : event.content;
                    console.log(`  <- ${display}`);
                }
                break;

            // ---- 审批事件 ----
            case 'approval_request':
                console.log();
                console.log(`  [审批] ${event.toolName}`);
                // 展示关键参数
                const args = event.args as Record<string, unknown>;
                if (args.filePath) {
                    console.log(`  文件: ${args.filePath}`);
                }
                if (args.content && typeof args.content === 'string') {
                    console.log(`  内容预览: ${(args.content as string).slice(0, 200)}...`);
                }

                const approveAnswer = await askUser('  确认执行？(Y/n) ');
                const approved =
                    approveAnswer === '' || approveAnswer.toLowerCase().startsWith('y');
                agent.resolveApproval(event.requestId, {
                    approved,
                    reason: approved ? undefined : '用户拒绝了此操作',
                });
                console.log(approved ? '  -> 已批准' : '  -> 已拒绝');
                break;

            // ---- 状态变更 ----
            case 'state_change':
                console.log(`  [状态] ${event.from} -> ${event.to}`);
                break;

            // ---- 计划事件 ----
            case 'plan_created':
                console.log(`  [计划] 包含 ${event.plan.steps.length} 个步骤`);
                break;

            case 'step_start':
                // onStepStart 钩子已打印
                break;

            case 'step_complete':
                // onStepComplete 钩子已打印
                break;

            case 'step_failed':
                // onStepFailed 钩子已处理
                break;

            case 'execution_paused':
                console.log(`\n[暂停] 执行已暂停在步骤 ${event.step.index + 1}`);
                break;

            // ---- Token 用量 ----
            case 'usage':
                console.log(
                    `  [Token] in=${event.usage.inputTokens} out=${event.usage.outputTokens}`,
                );
                break;

            // ---- 错误 ----
            case 'error':
                console.error(`  [错误] ${event.fatal ? '致命: ' : ''}${event.message}`);
                break;

            // ---- Agent 生命周期 ----
            case 'agent_end':
                console.log(`\n[结束] Agent 运行结束，原因: ${event.reason}`);
                break;
        }
    }
}

// ============================================================
// 主函数
// ============================================================

async function main() {
    console.log('='.repeat(60));
    console.log('  研发助手 (全功能综合示例)');
    console.log('='.repeat(60));
    console.log();
    console.log('集成功能:');
    console.log('  - PlanAndExecuteAgent: 先规划后执行');
    console.log('  - SubAgent (search_code): 委派代码搜索');
    console.log('  - builtinTools Extension: 文件操作');
    console.log('  - 审批系统: 文件写入需确认');
    console.log('  - 循环检测: 防止死循环');
    console.log('  - 上下文管理: Pipeline 处理器');
    console.log();

    const query =
        process.argv[2] ||
        '请审查这个项目的 packages/core/src/agent/ 目录下的代码，重点看 Agent 实现的代码质量';

    console.log(`> ${query}`);
    console.log();

    await consumeEvents(agent.run(query));

    console.log('\n' + '='.repeat(60));
    console.log('  审查完成');
    console.log('='.repeat(60));
    console.log('  如果生成了审查报告，请查看对应的 .md 文件。');
    console.log('  计划文件保存在: .agent-tea/plans/');
}

main().catch(console.error);
