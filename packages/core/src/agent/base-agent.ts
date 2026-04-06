/**
 * BaseAgent —— Agent 抽象基类
 *
 * 提取所有 Agent 共享的基础设施：
 * - ToolRegistry / Scheduler / StateMachine 的创建和持有
 * - run() 入口：sessionId 生成、signal 桥接、agent_start/end 事件
 * - collectResponse()：聚合 LLM 流式响应
 * - executeToolCalls()：带生命周期钩子的工具执行
 * - 生命周期钩子（默认空实现，子类按需覆写）
 *
 * 子类（ReActAgent、PlanAndExecuteAgent 等）只需实现：
 * - defineTransitions()：定义状态机转换规则
 * - executeLoop()：核心循环逻辑
 *
 * 架构位置：Core 层，Agent 子模块的基础抽象。
 */

import type { ChatSession } from '../llm/provider.js';
import type {
  ContentPart,
  Message,
  ToolResultPart,
} from '../llm/types.js';
import type { AgentConfig } from '../config/types.js';
import type { Tool, ToolResult } from '../tools/types.js';
import type { ToolCallRequest } from '../scheduler/executor.js';
import type {
  AgentEvent,
  AgentState,
  CollectedResponse,
  IterationContext,
  Plan,
  PlanApproval,
  PlanStep,
  StateTransition,
  StepFailureAction,
  StepResult,
  ToolCallDecision,
  ToolCallInfo,
} from './types.js';
import type { ApprovalDecision } from '../approval/types.js';
import type { ContextManager } from '../context/types.js';
import type { LoopDetectionConfig } from './loop-detection.js';
import { requiresApproval } from '../approval/policy.js';
import { createContextManager } from '../context/sliding-window.js';
import { ToolRegistry } from '../tools/registry.js';
import { Scheduler } from '../scheduler/scheduler.js';
import { AgentStateMachine } from './state-machine.js';
import { LoopDetector, DEFAULT_LOOP_DETECTION_CONFIG } from './loop-detection.js';

/** 默认最大迭代次数，防止 Agent 陷入无限循环 */
const DEFAULT_MAX_ITERATIONS = 20;

export abstract class BaseAgent {
  protected readonly config: AgentConfig;
  protected readonly registry: ToolRegistry;
  protected readonly scheduler: Scheduler;
  protected readonly stateMachine: AgentStateMachine;
  protected readonly agentId: string;

  /** 上下文管理器，在发 LLM 前裁剪消息列表 */
  protected readonly contextManager?: ContextManager;

  /** 循环检测器，检测重复工具调用和重复内容输出 */
  protected readonly loopDetector: LoopDetector;

  /**
   * 待处理的审批请求 —— key 是 requestId，value 是 resolve 回调。
   * 当消费者调用 resolveApproval() 时，对应的 Promise 被 resolve，
   * executeToolCalls 中的 await 随之恢复。
   */
  private pendingApprovals = new Map<
    string,
    (decision: ApprovalDecision) => void
  >();

  constructor(config: AgentConfig) {
    this.config = config;
    this.agentId = config.agentId ?? crypto.randomUUID();

    // 初始化时立即构建 ToolRegistry，确保工具名称冲突在创建阶段就暴露
    this.registry = new ToolRegistry();
    for (const tool of config.tools ?? []) {
      this.registry.register(tool);
    }

    this.scheduler = new Scheduler(this.registry);
    this.stateMachine = new AgentStateMachine(this.defineTransitions());

    // 初始化上下文管理器
    if (config.contextManager) {
      this.contextManager = createContextManager(config.contextManager);
    }

    // 初始化循环检测器
    const loopConfig: LoopDetectionConfig = {
      ...DEFAULT_LOOP_DETECTION_CONFIG,
      ...config.loopDetection,
    };
    this.loopDetector = new LoopDetector(loopConfig);
  }

  // ============================================================
  // 子类必须实现的抽象方法
  // ============================================================

  /** 定义该 Agent 类型的状态机转换规则 */
  protected abstract defineTransitions(): StateTransition[];

  /** 核心循环逻辑，由 run() 在 agent_start/end 之间调用 */
  protected abstract executeLoop(
    messages: Message[],
    sessionId: string,
    abortController: AbortController,
  ): AsyncGenerator<AgentEvent>;

  // ============================================================
  // 生命周期钩子（默认空实现，子类按需覆写）
  // ============================================================

  /** 每轮迭代开始前调用 */
  protected async onBeforeIteration(_ctx: IterationContext): Promise<void> {}

  /** 每轮迭代结束后调用 */
  protected async onAfterIteration(_ctx: IterationContext): Promise<void> {}

  /** 过滤工具列表，可用于根据 Agent 状态动态启用/禁用工具 */
  protected onToolFilter(tools: Tool[]): Tool[] {
    return tools;
  }

  /** Plan 创建后调用，返回审批结果 */
  protected async onPlanCreated(_plan: Plan): Promise<PlanApproval> {
    return { approved: true };
  }

  /** 步骤开始前调用 */
  protected async onStepStart(_step: PlanStep): Promise<void> {}

  /** 步骤完成后调用 */
  protected async onStepComplete(_step: PlanStep, _result: StepResult): Promise<void> {}

  /** 步骤失败时调用，返回失败处理策略 */
  protected async onStepFailed(_step: PlanStep, _error: Error): Promise<StepFailureAction> {
    return 'abort';
  }

  /** 工具调用前调用，返回是否允许执行以及可能修改的参数 */
  protected async onBeforeToolCall(
    _toolName: string,
    _args: Record<string, unknown>,
  ): Promise<ToolCallDecision> {
    return { allow: true };
  }

  /** 工具调用后调用 */
  protected async onAfterToolCall(
    _toolName: string,
    _result: ToolResult,
  ): Promise<void> {}

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 响应审批请求。
   *
   * 当消费者收到 'approval_request' 事件后，调用此方法提交用户决定。
   * Agent 循环会据此恢复执行或跳过该工具调用。
   *
   * @param requestId - 对应 ApprovalRequestEvent.requestId
   * @param decision  - 用户的审批决定
   */
  resolveApproval(requestId: string, decision: ApprovalDecision): void {
    const resolver = this.pendingApprovals.get(requestId);
    if (resolver) {
      resolver(decision);
      this.pendingApprovals.delete(requestId);
    }
  }

  /**
   * 运行 Agent 处理用户输入。
   *
   * 负责顶层关注点：sessionId、signal 桥接、agent_start/end 事件、异常兜底。
   * 核心循环逻辑委托给子类的 executeLoop()。
   */
  async *run(
    input: string | Message[],
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const sessionId = crypto.randomUUID();
    const abortController = new AbortController();

    // 将外部 signal 桥接到内部 controller
    if (signal) {
      signal.addEventListener('abort', () => abortController.abort(signal.reason), {
        once: true,
      });
    }

    yield { type: 'agent_start', sessionId, agentId: this.agentId };

    try {
      // 支持两种输入形式：简单字符串（常见场景）和预构建消息数组（高级场景）
      const messages: Message[] = Array.isArray(input)
        ? [...input]
        : [{ role: 'user', content: input }];

      yield* this.executeLoop(messages, sessionId, abortController);

      // 会话持久化：保存完整对话历史
      if (this.config.conversationStore) {
        await this.config.conversationStore.save(sessionId, messages, {
          model: this.config.model,
        });
      }

      // executeLoop 正常结束，根据状态机当前状态决定结束原因
      const state = this.stateMachine.current;
      let reason: 'complete' | 'error' | 'abort' | 'paused';
      if (state === 'aborted') {
        reason = 'abort';
      } else if (state === 'completed') {
        reason = 'complete';
      } else if (state === 'paused') {
        reason = 'paused';
      } else {
        reason = 'error';
      }

      yield { type: 'agent_end', sessionId, reason, agentId: this.agentId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: 'error',
        message,
        fatal: true,
        error: error instanceof Error ? error : undefined,
        agentId: this.agentId,
      };
      yield { type: 'agent_end', sessionId, reason: 'error', agentId: this.agentId };
    }
  }

  // ============================================================
  // 受保护的辅助方法（供子类使用）
  // ============================================================

  /**
   * 创建 ChatSession，应用 onToolFilter 钩子过滤工具列表。
   */
  protected createChatSession(): ChatSession {
    const allTools = this.registry.getAll();
    const filteredTools = this.onToolFilter(allTools);

    // 从过滤后的工具创建临时 registry 以生成 ToolDefinition
    let toolDefinitions;
    if (filteredTools.length > 0) {
      const tempRegistry = new ToolRegistry();
      for (const tool of filteredTools) {
        tempRegistry.register(tool);
      }
      toolDefinitions = tempRegistry.toToolDefinitions();
    }

    return this.config.provider.chat({
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      tools: toolDefinitions,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  /**
   * 从流式事件中收集完整的 LLM 响应。
   *
   * 将 ChatSession 的流式 AsyncGenerator 聚合为结构化结果，
   * 这样子类循环可以整体处理一轮 LLM 响应，简化主循环逻辑。
   *
   * 如果配置了 ContextManager，会在发送前自动裁剪消息列表。
   */
  protected async collectResponse(
    chatSession: ChatSession,
    messages: Message[],
    signal: AbortSignal,
  ): Promise<CollectedResponse> {
    let text = '';
    const toolCalls: ToolCallInfo[] = [];
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

    // 上下文裁剪：发送给 LLM 的是裁剪后的消息，原始 messages 不受影响
    const messagesToSend = this.contextManager
      ? this.contextManager.prepare(messages)
      : messages;

    for await (const event of chatSession.sendMessage(messagesToSend, signal)) {
      switch (event.type) {
        case 'text':
          text += event.text;
          break;
        case 'tool_call':
          toolCalls.push({ id: event.id, name: event.name, args: event.args });
          break;
        case 'finish':
          usage = event.usage;
          break;
        case 'error':
          throw event.error;
      }
    }

    return { text, toolCalls, usage };
  }

  /**
   * 执行工具调用，集成 onBeforeToolCall / onAfterToolCall 生命周期钩子。
   *
   * 对每个工具调用：
   * 1. 调用 onBeforeToolCall，若拒绝则跳过执行并生成错误结果
   * 2. 通过 Scheduler 执行工具
   * 3. 发出 tool_request / tool_response 事件
   * 4. 调用 onAfterToolCall
   */
  protected async *executeToolCalls(
    toolCalls: ToolCallInfo[],
    sessionId: string,
    messages: readonly Message[],
    abortSignal: AbortSignal,
  ): AsyncGenerator<AgentEvent, ToolResultPart[]> {
    const toolResults: ToolResultPart[] = [];

    const toolCallRequests: ToolCallRequest[] = [];
    const rejectedCalls = new Map<string, string>(); // id -> rejection reason

    // 先检查所有工具调用的权限（hook 层）
    for (const tc of toolCalls) {
      const decision = await this.onBeforeToolCall(tc.name, tc.args);
      if (decision.allow) {
        toolCallRequests.push({
          id: tc.id,
          name: tc.name,
          args: decision.modifiedArgs ?? tc.args,
        });
      } else {
        rejectedCalls.set(tc.id, `Tool call "${tc.name}" was rejected by onBeforeToolCall hook`);
      }
    }

    // 处理被拒绝的工具调用
    for (const tc of toolCalls) {
      const rejectionReason = rejectedCalls.get(tc.id);
      if (rejectionReason) {
        yield {
          type: 'tool_request',
          requestId: tc.id,
          toolName: tc.name,
          args: tc.args,
          agentId: this.agentId,
        };

        yield {
          type: 'tool_response',
          requestId: tc.id,
          toolName: tc.name,
          content: rejectionReason,
          isError: true,
          agentId: this.agentId,
        };

        toolResults.push({
          type: 'tool_result',
          toolCallId: tc.id,
          content: rejectionReason,
          isError: true,
        });
      }
    }

    // 审批检查 + 执行
    if (toolCallRequests.length > 0) {
      const toolContext = {
        sessionId,
        cwd: process.cwd(),
        messages,
        signal: abortSignal,
      };

      // 逐个处理：先审批检查，通过后再执行
      for (const request of toolCallRequests) {
        // 审批检查：根据 ApprovalPolicy 判断是否需要用户确认
        const tool = this.registry.get(request.name);
        if (tool && requiresApproval(tool, this.config.approvalPolicy)) {
          const requestId = crypto.randomUUID();

          // 创建一个 Promise，消费者调用 resolveApproval() 后才会 resolve
          const approvalPromise = new Promise<ApprovalDecision>(
            (resolve) => {
              this.pendingApprovals.set(requestId, resolve);
            },
          );

          // yield 审批请求事件，Agent 循环在此暂停
          yield {
            type: 'approval_request',
            requestId,
            toolName: request.name,
            args: request.args,
            toolDescription: tool.description,
            agentId: this.agentId,
          };

          // 等待用户决定（消费者在收到 approval_request 后调用 resolveApproval）
          const decision = await approvalPromise;

          if (!decision.approved) {
            // 用户拒绝，将拒绝原因返回给 LLM
            const reason =
              decision.reason ?? `Tool "${request.name}" was denied by user`;

            yield {
              type: 'tool_request',
              requestId: request.id,
              toolName: request.name,
              args: request.args,
              agentId: this.agentId,
            };

            yield {
              type: 'tool_response',
              requestId: request.id,
              toolName: request.name,
              content: reason,
              isError: true,
              agentId: this.agentId,
            };

            toolResults.push({
              type: 'tool_result',
              toolCallId: request.id,
              content: reason,
              isError: true,
            });

            continue;
          }

          // 用户可能修改了参数
          if (decision.modifiedArgs) {
            request.args = decision.modifiedArgs;
          }
        }

        // 执行工具（已通过审批或不需要审批）
        if (abortSignal.aborted) {
          toolResults.push({
            type: 'tool_result',
            toolCallId: request.id,
            content: 'Tool execution cancelled',
            isError: true,
          });
          continue;
        }

        const result = await this.scheduler.executeSingle(request, toolContext);
        const originalTc = toolCalls.find((tc) => tc.id === result.id);

        yield {
          type: 'tool_request',
          requestId: result.id,
          toolName: result.name,
          args: originalTc?.args ?? {},
          agentId: this.agentId,
        };

        yield {
          type: 'tool_response',
          requestId: result.id,
          toolName: result.name,
          content: result.result.content,
          isError: result.result.isError,
          agentId: this.agentId,
        };

        toolResults.push({
          type: 'tool_result',
          toolCallId: result.id,
          content: result.result.content,
          isError: result.result.isError,
        });

        await this.onAfterToolCall(result.name, result.result);
      }
    }

    return toolResults;
  }

  /** 获取配置中的最大迭代次数 */
  protected get maxIterations(): number {
    return this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  }
}
