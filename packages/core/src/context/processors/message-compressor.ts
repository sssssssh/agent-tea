/**
 * 消息压缩处理器（占位实现）
 *
 * 设计意图：当消息数量超过阈值时，对早期消息进行摘要压缩，
 * 理想情况下通过 LLM 调用生成摘要。
 *
 * 当前限制：ContextProcessor.process() 是同步接口，而 LLM 摘要需要异步调用。
 * 因此当前实现仅作为占位——直接返回原始消息，不做实际压缩。
 *
 * 后续扩展方向：
 * 1. 引入 AsyncContextProcessor 接口支持异步摘要
 * 2. 在 Agent 循环的其他钩子点（如 onBeforeIteration）触发异步摘要
 * 3. 将摘要结果缓存为特殊标记消息，后续 process 调用直接识别
 */

import type { Message } from '../../llm/types.js';
import type { ContextProcessor, TokenBudget } from '../types.js';

export interface MessageCompressorConfig {
    /** 异步摘要函数，当前版本未使用（预留接口） */
    summarize: (messages: Message[]) => Promise<string>;
    /** 触发压缩的消息数阈值，默认 30 */
    triggerThreshold?: number;
    /** 受保护的最近轮次数（不压缩），默认 5 */
    protectedTurns?: number;
}

export class MessageCompressor implements ContextProcessor {
    readonly name = 'message_compressor';

    constructor(private config: MessageCompressorConfig) {}

    /**
     * 当前为占位实现，直接返回原始消息。
     * 完整的 LLM 摘要功能需要异步接口支持，留待后续版本实现。
     */
    process(messages: Message[], _budget: TokenBudget): Message[] {
        // 占位实现：不做实际压缩
        // 未来异步版本将在消息数超过 triggerThreshold 时，
        // 对受保护区域外的早期消息调用 summarize 生成摘要
        return messages;
    }
}
