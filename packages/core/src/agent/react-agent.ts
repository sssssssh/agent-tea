/**
 * ReActAgent —— ReAct 模式的 Agent 实现
 *
 * 实现经典的 ReAct（Reasoning + Acting）循环：
 * 1. 将用户消息发送给 LLM
 * 2. 若 LLM 仅返回文本 -> 任务完成，退出循环
 * 3. 若 LLM 请求调用工具 -> 执行工具 -> 将结果反馈给 LLM -> 回到步骤 1
 *
 * 继承自 BaseAgent，状态机转换：idle -> reacting -> completed / error / aborted
 *
 * 架构位置：Core 层的 Agent 子模块，是最基础的 Agent 策略实现。
 */

import type {
  ContentPart,
  Message,
} from '../llm/types.js';
import type { AgentConfig } from '../config/types.js';
import type { AgentEvent, StateTransition } from './types.js';
import { BaseAgent } from './base-agent.js';
import { enterPlanModeTool } from '../tools/internal/enter-plan-mode.js';
import { exitPlanModeTool } from '../tools/internal/exit-plan-mode.js';

export class ReActAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    if (config.allowPlanMode) {
      // 注入 plan mode 工具到工具列表末尾
      const tools = [...(config.tools ?? []), enterPlanModeTool, exitPlanModeTool];
      super({ ...config, tools });
    } else {
      super(config);
    }
  }

  /**
   * ReAct 模式的状态转换规则：
   * idle -> reacting（开始处理）
   * reacting -> completed（LLM 完成任务）
   * reacting -> error（发生错误）
   * reacting -> aborted（被取消）
   */
  protected defineTransitions(): StateTransition[] {
    return [
      { from: 'idle', to: 'reacting' },
      { from: 'reacting', to: 'completed' },
      { from: 'reacting', to: 'error' },
      { from: 'reacting', to: 'aborted' },
    ];
  }

  /**
   * ReAct 核心循环。
   *
   * 每次迭代 = 一次 LLM 调用 + 可能的工具执行。
   * 循环持续直到 LLM 不再请求工具调用（表示任务完成）。
   */
  protected async *executeLoop(
    messages: Message[],
    sessionId: string,
    abortController: AbortController,
  ): AsyncGenerator<AgentEvent> {
    // 进入 reacting 状态
    const fromState = this.stateMachine.current;
    this.stateMachine.transition('reacting');
    yield {
      type: 'state_change',
      from: fromState,
      to: 'reacting',
      agentId: this.agentId,
    };

    // 创建 ChatSession
    const chatSession = this.createChatSession();
    const maxIter = this.maxIterations;

    for (let iteration = 0; iteration < maxIter; iteration++) {
      // 检查取消信号
      if (abortController.signal.aborted) {
        this.stateMachine.transition('aborted');
        yield {
          type: 'state_change',
          from: 'reacting',
          to: 'aborted',
          agentId: this.agentId,
        };
        return;
      }

      // 迭代前钩子
      await this.onBeforeIteration({
        iteration,
        messages,
        sessionId,
        state: this.stateMachine.current,
      });

      // 将完整消息历史发送给 LLM，收集流式响应
      const { text, toolCalls, usage } = await this.collectResponse(
        chatSession,
        messages,
        abortController.signal,
      );

      if (usage) {
        yield {
          type: 'usage',
          model: this.config.model,
          usage,
          agentId: this.agentId,
        };
      }

      if (text) {
        yield { type: 'message', role: 'assistant', content: text, agentId: this.agentId };
      }

      // 没有工具调用 -> LLM 认为任务已完成，退出循环
      if (toolCalls.length === 0) {
        const assistantParts: ContentPart[] = [];
        if (text) assistantParts.push({ type: 'text', text });
        messages.push({ role: 'assistant', content: assistantParts });

        // 迭代后钩子
        await this.onAfterIteration({
          iteration,
          messages,
          sessionId,
          state: this.stateMachine.current,
        });

        // 转换到 completed 状态
        this.stateMachine.transition('completed');
        yield {
          type: 'state_change',
          from: 'reacting',
          to: 'completed',
          agentId: this.agentId,
        };
        return;
      }

      // 将助手的文本和工具调用都记录到消息历史中
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

      // 通过 BaseAgent.executeToolCalls() 执行工具调用（含生命周期钩子）
      const toolResultsGen = this.executeToolCalls(
        toolCalls,
        sessionId,
        messages as readonly Message[],
        abortController.signal,
      );

      // 逐个 yield 工具事件，最终获取汇总的 toolResults
      let genResult = await toolResultsGen.next();
      while (!genResult.done) {
        yield genResult.value;
        genResult = await toolResultsGen.next();
      }
      const toolResults = genResult.value;

      // 将工具结果追加到消息历史，下次循环时 LLM 会看到这些结果
      messages.push({ role: 'tool', content: toolResults });

      // 迭代后钩子
      await this.onAfterIteration({
        iteration,
        messages,
        sessionId,
        state: this.stateMachine.current,
      });

      // 循环继续：带着工具结果再次调用 LLM
    }

    // 循环正常退出意味着超过了最大迭代次数（安全阀机制）
    yield {
      type: 'error',
      message: `Agent loop exceeded maximum iterations (${maxIter})`,
      fatal: true,
      agentId: this.agentId,
    };

    this.stateMachine.transition('error');
    yield {
      type: 'state_change',
      from: 'reacting',
      to: 'error',
      agentId: this.agentId,
    };
  }
}
