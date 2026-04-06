/**
 * 滑动窗口处理器
 *
 * 将原有 SlidingWindowContextManager 的核心逻辑提取为 ContextProcessor，
 * 可作为管道中的一个步骤使用。
 *
 * 策略：当消息总 token 超过预算时，保留头部 reservedCount 条消息和尾部最新消息，
 * 中间用截断标记替代。
 */

import type { Message } from '../../llm/types.js';
import type { ContextProcessor, TokenBudget } from '../types.js';

export interface SlidingWindowProcessorConfig {
  /** 始终保留的头部消息数，默认 1 */
  reservedMessageCount?: number;
}

export class SlidingWindowProcessor implements ContextProcessor {
  readonly name = 'sliding_window';
  private readonly reservedCount: number;

  constructor(config?: SlidingWindowProcessorConfig) {
    this.reservedCount = config?.reservedMessageCount ?? 1;
  }

  process(messages: Message[], budget: TokenBudget): Message[] {
    const totalTokens = budget.estimateTokens(messages);

    // 没超预算，原样返回
    if (totalTokens <= budget.maxTokens) {
      return messages;
    }

    // 分离保留消息和可裁剪消息
    const reserved = messages.slice(0, this.reservedCount);
    const candidates = messages.slice(this.reservedCount);

    // 计算保留消息占用的 token
    const reservedTokens = budget.estimateTokens(reserved);

    // 剩余预算给候选消息，留一点给截断标记
    const truncationMarkerTokens = 20;
    let remainingBudget =
      budget.maxTokens - reservedTokens - truncationMarkerTokens;

    if (remainingBudget <= 0) {
      // 保留消息本身就超预算了，只能返回保留消息
      return reserved;
    }

    // 从尾部（最新消息）开始向前累加，直到用完预算
    const kept: Message[] = [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const tokens = budget.estimateTokens([candidates[i]]);
      if (tokens > remainingBudget) {
        break;
      }
      remainingBudget -= tokens;
      kept.unshift(candidates[i]);
    }

    const droppedCount = candidates.length - kept.length;

    if (droppedCount === 0) {
      return messages;
    }

    // 插入截断标记，让 LLM 知道历史被截断
    const truncationMarker: Message = {
      role: 'user',
      content: `[系统提示：为控制上下文长度，中间 ${droppedCount} 条消息已被省略。请基于当前可见的上下文继续工作。]`,
    };

    return [...reserved, truncationMarker, ...kept];
  }
}
