/**
 * PlanAndExecuteAgent —— 计划-审批-执行 模式的 Agent 实现
 *
 * 三阶段工作流：
 * 1. Planning：运行只读 ReAct 子循环，LLM 用只读工具探索后生成计划
 * 2. Approval：保存计划文件、等待审批，被拒绝则带反馈重新规划
 * 3. Execution：逐步执行计划，每步运行一个有完整工具的 ReAct 子循环
 *
 * 继承自 BaseAgent，通过状态机管理阶段转换。
 *
 * 架构位置：Core 层的 Agent 子模块，适用于需要人机协作审批的复杂任务。
 */

import type { ContentPart, Message } from '../llm/types.js';
import type { AgentConfig } from '../config/types.js';
import type { Tool } from '../tools/types.js';
import type { AgentEvent, Plan, PlanStep, StateTransition, StepResult } from './types.js';
import { BaseAgent } from './base-agent.js';
import { LoopDetectedError } from '../errors/errors.js';
import { PlanStore } from './plan-store.js';

/** 单步执行的最大 ReAct 迭代次数 */
const STEP_MAX_ITERATIONS = 10;

export class PlanAndExecuteAgent extends BaseAgent {
    private readonly planStore: PlanStore;

    constructor(config: AgentConfig) {
        super(config);
        this.planStore = new PlanStore(config.planStoreDir);
    }

    // ============================================================
    // 状态转换定义
    // ============================================================

    protected defineTransitions(): StateTransition[] {
        return [
            { from: 'idle', to: 'planning' },
            { from: 'planning', to: 'awaiting_approval' },
            { from: 'awaiting_approval', to: 'executing' },
            { from: 'awaiting_approval', to: 'planning' }, // 被拒绝，重新规划
            { from: 'executing', to: 'completed' },
            { from: 'executing', to: 'step_failed' },
            { from: 'step_failed', to: 'executing' }, // 跳过或重试
            { from: 'step_failed', to: 'planning' }, // 重新规划
            { from: 'step_failed', to: 'paused' }, // 暂停执行
            { from: 'step_failed', to: 'error' },
            { from: 'step_failed', to: 'aborted' },
            { from: 'planning', to: 'error' },
            { from: 'planning', to: 'aborted' },
            { from: 'executing', to: 'error' },
            { from: 'executing', to: 'aborted' },
        ];
    }

    // ============================================================
    // 工具过滤：规划阶段只暴露只读工具
    // ============================================================

    protected onToolFilter(tools: Tool[]): Tool[] {
        if (this.stateMachine.current === 'planning') {
            return tools.filter((t) => t.tags?.includes('readonly'));
        }
        return tools;
    }

    // ============================================================
    // 核心执行入口
    // ============================================================

    protected async *executeLoop(
        messages: Message[],
        sessionId: string,
        abortController: AbortController,
    ): AsyncGenerator<AgentEvent> {
        yield* this.planPhase(messages, sessionId, abortController);
    }

    // ============================================================
    // Phase 1: Planning — 只读 ReAct 子循环生成计划
    // ============================================================

    /**
     * 进入规划阶段。
     * @param transitionToPlanning 是否需要执行状态转换到 planning（首次规划为 true，重新规划已在调用方完成转换则为 false）
     */
    private async *planPhase(
        messages: Message[],
        sessionId: string,
        abortController: AbortController,
        transitionToPlanning = true,
    ): AsyncGenerator<AgentEvent> {
        // 首次规划需要转换状态；重新规划时调用方已完成转换
        if (transitionToPlanning) {
            const fromState = this.stateMachine.current;
            this.stateMachine.transition('planning');
            yield {
                type: 'state_change',
                from: fromState,
                to: 'planning',
                agentId: this.agentId,
            };
        }

        // 运行规划循环，获取计划文本
        const planText = yield* this.runPlanningLoop(messages, sessionId, abortController);

        // planText 为 null 表示循环已处理了终止逻辑（abort 或超时 error）
        if (planText === null) return;

        // 解析计划
        const plan = this.parsePlan(planText);

        // Phase 2: Approval
        yield* this.approvalPhase(plan, messages, sessionId, abortController);
    }

    /**
     * 规划循环的核心逻辑 —— 运行只读 ReAct 子循环直到 LLM 输出计划文本。
     * 返回计划文本，如果因 abort 或超过迭代上限而终止则返回 null。
     */
    private async *runPlanningLoop(
        messages: Message[],
        sessionId: string,
        abortController: AbortController,
    ): AsyncGenerator<AgentEvent, string | null> {
        const chatSession = this.createChatSession();
        const maxIter = this.maxIterations;

        for (let iteration = 0; iteration < maxIter; iteration++) {
            if (abortController.signal.aborted) {
                this.stateMachine.transition('aborted');
                yield {
                    type: 'state_change',
                    from: 'planning',
                    to: 'aborted',
                    agentId: this.agentId,
                };
                return null;
            }

            await this.onBeforeIteration({
                iteration,
                messages,
                sessionId,
                state: this.stateMachine.current,
            });

            const { text, toolCalls, usage } = await this.collectResponse(
                chatSession,
                messages,
                abortController.signal,
            );

            if (usage) {
                yield { type: 'usage', model: this.config.model, usage, agentId: this.agentId };
            }

            if (text) {
                yield { type: 'message', role: 'assistant', content: text, agentId: this.agentId };
                this.loopDetector.trackContent(text);
            }

            // 没有工具调用 → LLM 输出了最终计划文本
            if (toolCalls.length === 0) {
                const assistantParts: ContentPart[] = [];
                if (text) assistantParts.push({ type: 'text', text });
                messages.push({ role: 'assistant', content: assistantParts });

                await this.onAfterIteration({
                    iteration,
                    messages,
                    sessionId,
                    state: this.stateMachine.current,
                });

                return text;
            }

            // 有工具调用 → 执行只读工具探索，继续循环
            const assistantParts: ContentPart[] = [];
            if (text) assistantParts.push({ type: 'text', text });
            for (const tc of toolCalls) {
                assistantParts.push({
                    type: 'tool_call',
                    toolCallId: tc.id,
                    toolName: tc.name,
                    args: tc.args,
                });
            }
            messages.push({ role: 'assistant', content: assistantParts });

            const toolResultsGen = this.executeToolCalls(
                toolCalls,
                sessionId,
                messages as readonly Message[],
                abortController.signal,
            );

            let genResult = await toolResultsGen.next();
            while (!genResult.done) {
                yield genResult.value;
                genResult = await toolResultsGen.next();
            }
            const toolResults = genResult.value;

            messages.push({ role: 'tool', content: toolResults });

            // 循环检测：追踪工具调用并检查是否陷入循环
            for (const tc of toolCalls) {
                this.loopDetector.trackToolCall(tc.name, tc.args);
            }

            const loopCheck = this.loopDetector.check();
            if (loopCheck.looping) {
                if (loopCheck.action === 'abort') {
                    throw new LoopDetectedError(loopCheck.type!);
                }
                messages.push({
                    role: 'user',
                    content:
                        '你似乎在重复相同的操作且没有进展。请分析当前策略为什么失败，然后尝试完全不同的方法。如果任务无法完成，请直接告知用户。',
                });
            }

            await this.onAfterIteration({
                iteration,
                messages,
                sessionId,
                state: this.stateMachine.current,
            });
        }

        // 超过迭代上限
        yield {
            type: 'error',
            message: `Planning phase exceeded maximum iterations (${maxIter})`,
            fatal: true,
            agentId: this.agentId,
        };
        this.stateMachine.transition('error');
        yield { type: 'state_change', from: 'planning', to: 'error', agentId: this.agentId };
        return null;
    }

    // ============================================================
    // Phase 2: Approval — 保存计划、等待审批
    // ============================================================

    private async *approvalPhase(
        plan: Plan,
        messages: Message[],
        sessionId: string,
        abortController: AbortController,
    ): AsyncGenerator<AgentEvent> {
        // 保存计划文件
        const filePath = await this.planStore.save(plan, sessionId);

        // 转换到 awaiting_approval 状态
        this.stateMachine.transition('awaiting_approval');
        yield {
            type: 'state_change',
            from: 'planning',
            to: 'awaiting_approval',
            agentId: this.agentId,
        };

        // 发出 plan_created 事件
        yield {
            type: 'plan_created',
            plan,
            filePath,
            agentId: this.agentId,
        };

        // 调用审批钩子
        const approval = await this.onPlanCreated(plan);

        if (!approval.approved) {
            // 被拒绝，带反馈重新规划
            const feedback = approval.feedback ?? 'Plan was rejected. Please create a new plan.';
            messages.push({ role: 'user', content: feedback });

            // awaiting_approval → planning
            this.stateMachine.transition('planning');
            yield {
                type: 'state_change',
                from: 'awaiting_approval',
                to: 'planning',
                agentId: this.agentId,
            };

            // 递归回到规划阶段（状态已经转换为 planning，无需再次转换）
            yield* this.planPhase(messages, sessionId, abortController, false);
            return;
        }

        // 审批通过，进入执行阶段
        yield* this.executePhase(plan, sessionId, abortController);
    }

    // ============================================================
    // Phase 3: Execution — 逐步执行计划
    // ============================================================

    private async *executePhase(
        plan: Plan,
        sessionId: string,
        abortController: AbortController,
    ): AsyncGenerator<AgentEvent> {
        // 转换到 executing 状态
        this.stateMachine.transition('executing');
        yield {
            type: 'state_change',
            from: 'awaiting_approval',
            to: 'executing',
            agentId: this.agentId,
        };

        for (const step of plan.steps) {
            if (abortController.signal.aborted) {
                this.stateMachine.transition('aborted');
                yield {
                    type: 'state_change',
                    from: 'executing',
                    to: 'aborted',
                    agentId: this.agentId,
                };
                return;
            }

            // 发出 step_start 事件
            step.status = 'executing';
            await this.onStepStart(step);
            yield { type: 'step_start', step, agentId: this.agentId };

            try {
                // 为每步创建新的 ChatSession（完整工具集）
                const stepResult = yield* this.executeStep(step, plan, sessionId, abortController);

                // 步骤成功完成
                step.status = 'completed';
                step.result = stepResult;

                // 更新计划文件
                await this.planStore.updateStep(plan.filePath, step.index, 'completed');

                await this.onStepComplete(step, stepResult);
                yield { type: 'step_complete', step, agentId: this.agentId };
            } catch (error) {
                // 步骤执行失败
                step.status = 'failed';

                this.stateMachine.transition('step_failed');
                yield {
                    type: 'state_change',
                    from: 'executing',
                    to: 'step_failed',
                    agentId: this.agentId,
                };

                const stepError = error instanceof Error ? error : new Error(String(error));

                yield {
                    type: 'step_failed',
                    step,
                    error: stepError,
                    agentId: this.agentId,
                };

                // 调用失败处理钩子
                const action = await this.onStepFailed(step, stepError);

                switch (action) {
                    case 'skip':
                        step.status = 'skipped';
                        await this.planStore.updateStep(plan.filePath, step.index, 'skipped');
                        // 恢复到 executing 继续下一步
                        this.stateMachine.transition('executing');
                        yield {
                            type: 'state_change',
                            from: 'step_failed',
                            to: 'executing',
                            agentId: this.agentId,
                        };
                        continue;

                    case 'pause':
                        yield {
                            type: 'execution_paused',
                            step,
                            error: stepError,
                            agentId: this.agentId,
                        };
                        // step_failed → paused，表示执行被暂停而非完成或出错
                        this.stateMachine.transition('paused');
                        yield {
                            type: 'state_change',
                            from: 'step_failed',
                            to: 'paused',
                            agentId: this.agentId,
                        };
                        return;

                    case 'replan':
                        // step_failed → planning，重新规划
                        this.stateMachine.transition('planning');
                        yield {
                            type: 'state_change',
                            from: 'step_failed',
                            to: 'planning',
                            agentId: this.agentId,
                        };
                        // 需要新的 messages 来进行重新规划
                        const replanMessages: Message[] = [
                            {
                                role: 'user',
                                content: `The previous plan failed at step ${step.index + 1}: "${step.description}". Error: ${stepError.message}. Please create a new plan.`,
                            },
                        ];
                        yield* this.planPhase(replanMessages, sessionId, abortController, false);
                        return;

                    case 'abort':
                    default:
                        this.stateMachine.transition('aborted');
                        yield {
                            type: 'state_change',
                            from: 'step_failed',
                            to: 'aborted',
                            agentId: this.agentId,
                        };
                        return;
                }
            }
        }

        // 所有步骤完成
        this.stateMachine.transition('completed');
        yield {
            type: 'state_change',
            from: 'executing',
            to: 'completed',
            agentId: this.agentId,
        };
    }

    /**
     * 执行单个步骤的 ReAct 子循环。
     * 为该步创建新的 ChatSession（完整工具集），发送步骤描述作为用户消息。
     */
    private async *executeStep(
        step: PlanStep,
        plan: Plan,
        sessionId: string,
        abortController: AbortController,
    ): AsyncGenerator<AgentEvent, StepResult> {
        const stepMessages: Message[] = [
            {
                role: 'user',
                content: `Execute the following step from the plan:\n\nStep ${step.index + 1}: ${step.description}\n\nFull plan context:\n${plan.rawContent}`,
            },
        ];

        // 创建带完整工具集的 ChatSession（executing 状态不会过滤工具）
        const chatSession = this.createChatSession();
        let toolCallCount = 0;
        let lastText = '';

        for (let iteration = 0; iteration < STEP_MAX_ITERATIONS; iteration++) {
            if (abortController.signal.aborted) {
                throw new Error('Step execution aborted');
            }

            const { text, toolCalls, usage } = await this.collectResponse(
                chatSession,
                stepMessages,
                abortController.signal,
            );

            if (usage) {
                yield { type: 'usage', model: this.config.model, usage, agentId: this.agentId };
            }

            if (text) {
                lastText = text;
                yield { type: 'message', role: 'assistant', content: text, agentId: this.agentId };
                this.loopDetector.trackContent(text);
            }

            // 没有工具调用 → 步骤完成
            if (toolCalls.length === 0) {
                const assistantParts: ContentPart[] = [];
                if (text) assistantParts.push({ type: 'text', text });
                stepMessages.push({ role: 'assistant', content: assistantParts });

                return {
                    summary: lastText || 'Step completed',
                    toolCallCount,
                };
            }

            // 有工具调用 → 执行并继续
            toolCallCount += toolCalls.length;

            const assistantParts: ContentPart[] = [];
            if (text) assistantParts.push({ type: 'text', text });
            for (const tc of toolCalls) {
                assistantParts.push({
                    type: 'tool_call',
                    toolCallId: tc.id,
                    toolName: tc.name,
                    args: tc.args,
                });
            }
            stepMessages.push({ role: 'assistant', content: assistantParts });

            const toolResultsGen = this.executeToolCalls(
                toolCalls,
                sessionId,
                stepMessages as readonly Message[],
                abortController.signal,
            );

            let genResult = await toolResultsGen.next();
            while (!genResult.done) {
                yield genResult.value;
                genResult = await toolResultsGen.next();
            }
            const toolResults = genResult.value;

            stepMessages.push({ role: 'tool', content: toolResults });

            // 循环检测：追踪工具调用并检查是否陷入循环
            for (const tc of toolCalls) {
                this.loopDetector.trackToolCall(tc.name, tc.args);
            }

            const loopCheck = this.loopDetector.check();
            if (loopCheck.looping) {
                if (loopCheck.action === 'abort') {
                    throw new LoopDetectedError(loopCheck.type!);
                }
                stepMessages.push({
                    role: 'user',
                    content:
                        '你似乎在重复相同的操作且没有进展。请分析当前策略为什么失败，然后尝试完全不同的方法。如果任务无法完成，请直接告知用户。',
                });
            }
        }

        // 超过步骤最大迭代次数
        throw new Error(
            `Step ${step.index + 1} exceeded maximum iterations (${STEP_MAX_ITERATIONS})`,
        );
    }

    // ============================================================
    // Plan 解析
    // ============================================================

    /**
     * 将 LLM 输出的文本解析为 Plan 对象。
     *
     * 解析策略：
     * 1. 尝试提取 ```plan ... ``` 代码块内容
     * 2. 解析编号行（1. xxx, 1) xxx）或无序列表行（- xxx）
     * 3. 若没有找到结构化步骤，将整段文本作为单步计划
     */
    private parsePlan(text: string): Plan {
        // 尝试提取 ```plan ... ``` 代码块
        const codeBlockMatch = text.match(/```plan\s*\n([\s\S]*?)```/);
        const content = codeBlockMatch ? codeBlockMatch[1].trim() : text;

        const steps: PlanStep[] = [];

        // 解析编号行或无序列表行
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // 匹配 "1. xxx" 或 "1) xxx" 格式
            const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
            // 匹配 "- xxx" 格式
            const bulletMatch = trimmed.match(/^-\s+(.+)/);

            const description = numberedMatch?.[1] ?? bulletMatch?.[1];
            if (description) {
                steps.push({
                    index: steps.length,
                    description,
                    status: 'pending',
                });
            }
        }

        // 没找到结构化步骤，整段文本作为单步
        if (steps.length === 0) {
            steps.push({
                index: 0,
                description: content,
                status: 'pending',
            });
        }

        return {
            id: crypto.randomUUID(),
            filePath: '', // 由 PlanStore.save() 填充
            steps,
            rawContent: text,
            createdAt: new Date(),
        };
    }
}
