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

/**
 * @experimental 当前为占位实现，不会实际压缩消息。
 * 完整的 LLM 摘要功能需要异步接口支持（AsyncContextProcessor），留待后续版本实现。
 * 配置此处理器不会产生副作用，但也不会获得压缩收益。
 */
export class MessageCompressor implements ContextProcessor {
    readonly name = 'message_compressor';
    private warned = false;

    constructor(private config: MessageCompressorConfig) {}

    /**
     * 当前为占位实现，直接返回原始消息。
     * 完整的 LLM 摘要功能需要异步接口支持，留待后续版本实现。
     *
     * @experimental
     */
    process(messages: Message[], _budget: TokenBudget): Message[] {
        // 首次调用时发出警告，避免用户误以为压缩已生效
        if (!this.warned) {
            console.warn(
                '[agent-tea] MessageCompressor 当前为占位实现，不会实际压缩消息。' +
                    '完整实现需要异步接口支持，请关注后续版本更新。',
            );
            this.warned = true;
        }
        return messages;
    }
}
