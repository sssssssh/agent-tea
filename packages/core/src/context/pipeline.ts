/**
 * 管道式上下文管理器
 *
 * 将多个 ContextProcessor 串联为处理管道，消息依次经过每个处理器。
 * 这种设计让不同的上下文裁剪策略可以自由组合——
 * 比如先截断工具输出，再做滑动窗口裁剪。
 *
 * 架构位置：Core 层 Context 子模块，ContextManager 接口的管道式实现。
 */

import type { Message } from '../llm/types.js';
import type { ContextManager, ContextProcessor, TokenBudget } from './types.js';

export class PipelineContextManager implements ContextManager {
    private processors: ContextProcessor[];
    private maxTokens: number;

    constructor(processors: ContextProcessor[], config: { maxTokens: number }) {
        this.processors = processors;
        this.maxTokens = config.maxTokens;
    }

    /**
     * 将消息依次通过每个处理器，返回最终结果。
     * 每个处理器都能访问 token 预算信息来做裁剪决策。
     */
    prepare(messages: Message[]): Message[] {
        const budget: TokenBudget = {
            maxTokens: this.maxTokens,
            estimateTokens: this.estimateTokens.bind(this),
        };

        let result = messages;
        for (const processor of this.processors) {
            result = processor.process(result, budget);
        }
        return result;
    }

    /**
     * 估算消息列表的 token 总数。
     * 采用 chars / 4 的粗略公式（GPT 系列的经验值），避免引入 tokenizer 依赖。
     */
    private estimateTokens(messages: Message[]): number {
        let total = 0;
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                total += Math.ceil(msg.content.length / 4);
            } else {
                for (const part of msg.content) {
                    if ('text' in part) total += Math.ceil(part.text.length / 4);
                    else if ('content' in part) total += Math.ceil(part.content.length / 4);
                    else if ('args' in part)
                        total += Math.ceil(JSON.stringify(part.args).length / 4);
                }
            }
        }
        return total;
    }
}
