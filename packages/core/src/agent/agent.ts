/**
 * Agent —— 核心 Agent 循环（整个框架最重要的模块）
 *
 * 编排 LLM ↔ Tool 的交互循环：
 * 1. 将用户消息发送给 LLM
 * 2. 若 LLM 仅返回文本 → 任务完成，退出循环
 * 3. 若 LLM 请求调用工具 → 执行工具 → 将结果反馈给 LLM → 回到步骤 1
 *
 * 这个循环就是 ReAct（Reasoning + Acting）模式的实现：
 * LLM 负责推理和决策（调用哪个工具、传什么参数），
 * Agent 负责执行和状态管理（工具调度、消息历史、事件分发）。
 *
 * 架构位置：Core 层的顶层编排者，组合了 LLM Provider、ToolRegistry、Scheduler。
 */

import { MaxIterationsError } from '../errors/errors.js';
import type { ChatSession } from '../llm/provider.js';
import type {
  AssistantMessage,
  ChatStreamEvent,
  ContentPart,
  Message,
  ToolCallPart,
  ToolResultPart,
} from '../llm/types.js';
import type { AgentConfig } from '../config/types.js';
import type { AgentEvent } from './types.js';
import { ToolRegistry } from '../tools/registry.js';
import { Scheduler, } from '../scheduler/scheduler.js';
import type { ToolCallRequest } from '../scheduler/executor.js';

/** 默认最大迭代次数，防止 Agent 陷入无限循环 */
const DEFAULT_MAX_ITERATIONS = 20;

export class Agent {
  private readonly config: AgentConfig;
  private readonly registry: ToolRegistry;
  private readonly scheduler: Scheduler;

  constructor(config: AgentConfig) {
    this.config = config;

    // 初始化时立即构建 ToolRegistry，确保工具名称冲突在创建阶段就暴露
    this.registry = new ToolRegistry();
    for (const tool of config.tools ?? []) {
      this.registry.register(tool);
    }

    this.scheduler = new Scheduler(this.registry);
  }

  /**
   * 运行 Agent 处理用户输入。
   *
   * 采用 AsyncGenerator 模式的原因：
   * - 调用方可以逐个处理事件，实现实时 UI 更新
   * - 天然支持背压（backpressure），消费者处理不过来时生产者自动暂停
   * - 调用方可随时 break 退出，触发清理逻辑
   *
   * @param input - 用户输入（字符串或预构建的消息数组）
   * @param signal - 外部取消信号（如用户按 Ctrl+C）
   */
  async *run(
    input: string | Message[],
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const sessionId = crypto.randomUUID();
    const abortController = new AbortController();

    // 将外部 signal 桥接到内部 controller，这样内部可以统一用 abortController.signal
    if (signal) {
      signal.addEventListener('abort', () => abortController.abort(signal.reason), {
        once: true,
      });
    }

    yield { type: 'agent_start', sessionId };

    try {
      // 支持两种输入形式：简单字符串（常见场景）和预构建消息数组（高级场景）
      const messages: Message[] = Array.isArray(input)
        ? [...input]
        : [{ role: 'user', content: input }];

      // 创建 ChatSession，绑定模型、工具定义等配置
      // 注意：没有注册工具时不传 tools 参数，避免某些 LLM 对空工具列表报错
      const chatSession = this.config.provider.chat({
        model: this.config.model,
        systemPrompt: this.config.systemPrompt,
        tools: this.registry.size > 0
          ? this.registry.toToolDefinitions()
          : undefined,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      });

      const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

      // ============================================================
      // 核心 Agent 循环
      // 每次迭代 = 一次 LLM 调用 + 可能的工具执行
      // 循环持续直到 LLM 不再请求工具调用（表示任务完成）
      // ============================================================
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // 检查取消信号
        if (abortController.signal.aborted) {
          yield { type: 'agent_end', sessionId, reason: 'abort' };
          return;
        }

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
          };
        }

        if (text) {
          yield { type: 'message', role: 'assistant', content: text };
        }

        // 没有工具调用 → LLM 认为任务已完成，退出循环
        if (toolCalls.length === 0) {
          const assistantParts: ContentPart[] = [];
          if (text) assistantParts.push({ type: 'text', text });
          messages.push({ role: 'assistant', content: assistantParts });

          yield { type: 'agent_end', sessionId, reason: 'complete' };
          return;
        }

        // 将助手的文本和工具调用都记录到消息历史中
        // LLM 需要看到完整的历史才能保持上下文一致性
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

        // 通过 Scheduler 执行工具调用
        const toolResults: ToolResultPart[] = [];
        const toolCallRequests: ToolCallRequest[] = toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
        }));

        const toolContext = {
          sessionId,
          cwd: process.cwd(),
          messages: messages as readonly Message[],
          signal: abortController.signal,
        };

        for await (const result of this.scheduler.execute(toolCallRequests, toolContext)) {
          // 先发 request 事件再发 response 事件，让消费者能展示"正在调用..."的状态
          yield {
            type: 'tool_request',
            requestId: result.id,
            toolName: result.name,
            args: toolCalls.find((tc) => tc.id === result.id)?.args ?? {},
          };

          yield {
            type: 'tool_response',
            requestId: result.id,
            toolName: result.name,
            content: result.result.content,
            isError: result.result.isError,
          };

          toolResults.push({
            type: 'tool_result',
            toolCallId: result.id,
            content: result.result.content,
            isError: result.result.isError,
          });
        }

        // 将工具结果追加到消息历史，下次循环时 LLM 会看到这些结果
        messages.push({ role: 'tool', content: toolResults });

        // 循环继续：带着工具结果再次调用 LLM
      }

      // 循环正常退出意味着超过了最大迭代次数（安全阀机制）
      yield {
        type: 'error',
        message: `Agent loop exceeded maximum iterations (${maxIterations})`,
        fatal: true,
      };
      yield { type: 'agent_end', sessionId, reason: 'error' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', message, fatal: true, error: error instanceof Error ? error : undefined };
      yield { type: 'agent_end', sessionId, reason: 'error' };
    }
  }

  /**
   * 从流式事件中收集完整的 LLM 响应。
   *
   * 将 ChatSession 的流式 AsyncGenerator 聚合为结构化结果，
   * 这样 Agent 循环可以整体处理一轮 LLM 响应，简化主循环逻辑。
   */
  private async collectResponse(
    chatSession: ChatSession,
    messages: Message[],
    signal: AbortSignal,
  ): Promise<{
    text: string;
    toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  }> {
    let text = '';
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

    for await (const event of chatSession.sendMessage(messages, signal)) {
      switch (event.type) {
        case 'text':
          // 增量拼接文本片段
          text += event.text;
          break;
        case 'tool_call':
          toolCalls.push({ id: event.id, name: event.name, args: event.args });
          break;
        case 'finish':
          usage = event.usage;
          break;
        case 'error':
          // 将流式错误转为异常，由 run() 的 try/catch 统一处理
          throw event.error;
      }
    }

    return { text, toolCalls, usage };
  }
}
