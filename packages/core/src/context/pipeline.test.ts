import { describe, it, expect } from 'vitest';
import { PipelineContextManager } from './pipeline.js';
import type { Message } from '../llm/types.js';
import type { ContextProcessor, TokenBudget } from './types.js';

/**
 * PipelineContextManager 单元测试
 *
 * 验证管道式上下文管理器的核心行为：
 * - 无处理器时透传消息
 * - 多处理器按顺序链式执行
 * - token 预算正确传递
 * - 空消息数组的边界情况
 */

/** 创建一个简单的处理器，对每条 user 消息追加后缀 */
function createSuffixProcessor(suffix: string): ContextProcessor {
    return {
        name: `suffix_${suffix}`,
        process(messages: Message[], _budget: TokenBudget): Message[] {
            return messages.map((msg) => {
                if (msg.role === 'user' && typeof msg.content === 'string') {
                    return { ...msg, content: msg.content + suffix };
                }
                return msg;
            });
        },
    };
}

/** 创建一个记录 budget 参数的处理器 */
function createBudgetCaptor(): {
    processor: ContextProcessor;
    captured: TokenBudget[];
} {
    const captured: TokenBudget[] = [];
    const processor: ContextProcessor = {
        name: 'budget_captor',
        process(messages: Message[], budget: TokenBudget): Message[] {
            captured.push(budget);
            return messages;
        },
    };
    return { processor, captured };
}

describe('PipelineContextManager', () => {
    const sampleMessages: Message[] = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    ];

    it('returns messages unchanged when no processors', () => {
        const pipeline = new PipelineContextManager([], { maxTokens: 1000 });
        const result = pipeline.prepare(sampleMessages);

        expect(result).toEqual(sampleMessages);
    });

    it('chains multiple processors in order', () => {
        const processorA = createSuffixProcessor('_A');
        const processorB = createSuffixProcessor('_B');

        const pipeline = new PipelineContextManager([processorA, processorB], {
            maxTokens: 1000,
        });
        const result = pipeline.prepare([{ role: 'user', content: 'msg' }]);

        // A 先执行 -> "msg_A"，B 再执行 -> "msg_A_B"
        expect(result).toEqual([{ role: 'user', content: 'msg_A_B' }]);
    });

    it('passes token budget to each processor', () => {
        const captor1 = createBudgetCaptor();
        const captor2 = createBudgetCaptor();

        const pipeline = new PipelineContextManager([captor1.processor, captor2.processor], {
            maxTokens: 4096,
        });
        pipeline.prepare(sampleMessages);

        // 两个处理器都应收到 budget
        expect(captor1.captured).toHaveLength(1);
        expect(captor2.captured).toHaveLength(1);

        // maxTokens 一致
        expect(captor1.captured[0].maxTokens).toBe(4096);
        expect(captor2.captured[0].maxTokens).toBe(4096);

        // estimateTokens 是可调用的函数
        expect(typeof captor1.captured[0].estimateTokens).toBe('function');

        // estimateTokens 对字符串内容按 chars/4 估算
        const estimate = captor1.captured[0].estimateTokens([
            { role: 'user', content: 'abcdefgh' }, // 8 chars -> 2 tokens
        ]);
        expect(estimate).toBe(2);
    });

    it('handles empty message array', () => {
        const processor = createSuffixProcessor('_X');
        const pipeline = new PipelineContextManager([processor], {
            maxTokens: 1000,
        });

        const result = pipeline.prepare([]);
        expect(result).toEqual([]);
    });
});
