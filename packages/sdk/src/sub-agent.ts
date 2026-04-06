/**
 * Sub-Agent —— 将 Agent 包装为 Tool，实现多 Agent 协作
 *
 * 核心思想：子 Agent 对父 Agent 来说就是一个普通工具。
 * 父 Agent 通过 tool calling 给子 Agent 下发任务，子 Agent 自主完成后返回结果。
 *
 * 这种设计使得：
 * - 父 Agent 不需要知道子 Agent 的内部实现（工具、模型等）
 * - 子 Agent 可以有自己的工具集和 system prompt，专注于特定领域
 * - 多层嵌套自然支持（子 Agent 可以有自己的子 Agent）
 * - 父 Agent 的 LLM 自行决定何时委派任务给子 Agent
 *
 * 架构位置：SDK 层，依赖 Core 层的 Agent 和 tool() 工厂函数。
 *
 * @example
 * ```typescript
 * const researcher = subAgent({
 *   name: 'research',
 *   description: 'Deep research on a topic',
 *   provider: openai,
 *   model: 'gpt-4o-mini',
 *   tools: [webSearch],
 *   systemPrompt: 'You are a research assistant.',
 * });
 *
 * const mainAgent = new Agent({
 *   tools: [researcher], // 子 Agent 作为工具注册到父 Agent
 * });
 * ```
 */

import { z } from 'zod';
import { ReActAgent, tool, type LLMProvider, type Tool } from '@t-agent/core';

export interface SubAgentConfig {
  /** 工具名称（父 Agent 通过此名称调用子 Agent） */
  name: string;
  /** 子 Agent 的能力描述（发送给父 LLM，帮助其决定何时委派） */
  description: string;
  /** 子 Agent 使用的 LLM Provider（可以与父 Agent 不同） */
  provider: LLMProvider;
  /** 子 Agent 使用的模型（可以用更便宜的模型执行子任务） */
  model: string;
  /** 子 Agent 可用的工具 */
  tools?: Tool[];
  /** 子 Agent 的 system prompt */
  systemPrompt?: string;
  /** 子 Agent 循环最大迭代次数（默认 10，比主 Agent 的 20 更保守） */
  maxIterations?: number;
}

/**
 * 创建子 Agent 工具。
 * 父 Agent 调用时传入任务描述，子 Agent 自主运行，
 * 收集所有 assistant 消息作为结果返回给父 Agent。
 */
export function subAgent(config: SubAgentConfig): Tool {
  // 在创建时就实例化 Agent，避免每次调用都重新创建
  const agent = new ReActAgent({
    provider: config.provider,
    model: config.model,
    tools: config.tools,
    systemPrompt: config.systemPrompt,
    maxIterations: config.maxIterations ?? 10,
  });

  return tool(
    {
      name: config.name,
      description: config.description,
      // 子 Agent 只接收一个 task 参数，由父 LLM 描述要完成的任务
      parameters: z.object({
        task: z.string().describe('The task for the sub-agent to complete'),
      }),
    },
    async ({ task }) => {
      let result = '';

      // 运行子 Agent，收集所有 assistant 消息拼接为最终结果
      for await (const event of agent.run(task)) {
        if (event.type === 'message' && event.role === 'assistant') {
          result += event.content;
        }
        // 致命错误时立即返回错误信息，不继续等待
        if (event.type === 'error' && event.fatal) {
          return { content: `Sub-agent error: ${event.message}`, isError: true };
        }
      }

      return result || 'Sub-agent completed without output.';
    },
  );
}
