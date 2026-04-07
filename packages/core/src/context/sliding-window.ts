/**
 * 滑动窗口上下文管理器
 *
 * 最简单实用的上下文裁剪策略：当消息总 token 超过预算时，
 * 从最早的消息开始丢弃，保留最近的消息。
 *
 * 设计要点：
 * - reservedMessages 保护头部消息不被丢弃（通常是第一条用户消息，提供任务上下文）
 * - Token 估算用字符数 / 4 的粗略公式，避免引入 tokenizer 依赖
 * - 非破坏性，返回新数组
 *
 * 架构位置：Core 层 Context 子模块，ContextManager 接口的默认实现。
 */

import type { Message } from '../llm/types.js';
import { PipelineContextManager } from './pipeline.js';
import { SlidingWindowProcessor } from './processors/sliding-window.js';
import type { ContextManager, ContextManagerConfig } from './types.js';

/**
 * 估算单条消息的 token 数。
 *
 * 采用 chars / 4 的粗略公式（GPT 系列的经验值）。
 * 中文字符密度更高，实际 token 数可能偏高，但作为保守估算是安全的。
 */
function estimateTokens(message: Message): number {
    if (typeof message.content === 'string') {
        return Math.ceil(message.content.length / 4);
    }

    // content 是 ContentPart[] 或 ToolResultPart[]
    let totalChars = 0;
    for (const part of message.content) {
        if ('text' in part) {
            totalChars += part.text.length;
        } else if ('content' in part) {
            totalChars += part.content.length;
        } else if ('args' in part) {
            totalChars += JSON.stringify(part.args).length;
        }
    }
    return Math.ceil(totalChars / 4);
}

/**
 * @deprecated 使用 PipelineContextManager + SlidingWindowProcessor 替代。
 * 保留此类仅为向后兼容，新代码应使用 createContextManager() 或直接使用 PipelineContextManager。
 */
export class SlidingWindowContextManager implements ContextManager {
    private readonly maxTokens: number;
    private readonly reservedCount: number;

    constructor(config: ContextManagerConfig) {
        this.maxTokens = config.maxTokens;
        this.reservedCount = config.reservedMessageCount ?? 1;
    }

    /**
     * 裁剪消息列表使其 token 总量不超过预算。
     *
     * 策略：保留头部 reservedCount 条消息 + 尾部尽可能多的消息。
     * 中间被丢弃的消息用一条标记消息替代，让 LLM 知道上下文被截断了。
     */
    prepare(messages: Message[]): Message[] {
        const totalTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);

        // 没超预算，原样返回
        if (totalTokens <= this.maxTokens) {
            return messages;
        }

        // 分离保留消息和可裁剪消息
        const reserved = messages.slice(0, this.reservedCount);
        const candidates = messages.slice(this.reservedCount);

        // 计算保留消息占用的 token
        const reservedTokens = reserved.reduce((sum, msg) => sum + estimateTokens(msg), 0);

        // 剩余预算给候选消息，留一点给截断标记
        const truncationMarkerTokens = 20;
        let remainingBudget = this.maxTokens - reservedTokens - truncationMarkerTokens;

        if (remainingBudget <= 0) {
            // 保留消息本身就超预算了，只能全部返回保留消息
            return reserved;
        }

        // 从尾部（最新消息）开始向前累加，直到用完预算
        const kept: Message[] = [];
        for (let i = candidates.length - 1; i >= 0; i--) {
            const tokens = estimateTokens(candidates[i]);
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

/**
 * 根据配置创建 ContextManager 实例。
 *
 * - strategy: 'pipeline' + processors: 使用自定义处理器管道
 * - 默认（sliding_window）: 内部用 PipelineContextManager + SlidingWindowProcessor 实现
 */
export function createContextManager(config: ContextManagerConfig): ContextManager {
    if (config.strategy === 'pipeline' && config.processors) {
        return new PipelineContextManager(config.processors, {
            maxTokens: config.maxTokens,
        });
    }

    // 默认 sliding_window（向后兼容），内部统一用 Pipeline 实现
    return new PipelineContextManager(
        [
            new SlidingWindowProcessor({
                reservedMessageCount: config.reservedMessageCount,
            }),
        ],
        { maxTokens: config.maxTokens },
    );
}
