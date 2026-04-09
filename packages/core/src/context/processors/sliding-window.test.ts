import { describe, it, expect } from 'vitest';
import { SlidingWindowProcessor } from './sliding-window.js';
import type { Message } from '../../llm/types.js';
import type { TokenBudget } from '../types.js';

/**
 * 创建简单的 TokenBudget：用字符数作为 token 估算。
 * 这让测试可以精确控制 token 预算和消息大小。
 */
function createBudget(maxTokens: number): TokenBudget {
    return {
        maxTokens,
        estimateTokens(messages: Message[]): number {
            return messages.reduce((sum, msg) => {
                const content =
                    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                return sum + content.length;
            }, 0);
        },
    };
}

function userMsg(text: string): Message {
    return { role: 'user', content: text };
}

function assistantMsg(text: string): Message {
    return { role: 'assistant', content: [{ type: 'text', text }] };
}

describe('SlidingWindowProcessor', () => {
    it('returns all messages when within budget', () => {
        const processor = new SlidingWindowProcessor({ reservedMessageCount: 1 });
        const messages: Message[] = [userMsg('hello'), assistantMsg('hi'), userMsg('how are you')];

        // 预算远大于消息总长度，不触发裁剪
        const budget = createBudget(10000);
        const result = processor.process(messages, budget);

        expect(result).toEqual(messages);
    });

    it('trims oldest messages (keeping first N preserved) when over budget', () => {
        const processor = new SlidingWindowProcessor({ reservedMessageCount: 1 });

        // 第一条消息（保留）+ 4 条历史消息
        const messages: Message[] = [
            userMsg('system prompt'), // 保留（reserved）
            assistantMsg('response 1'), // 可裁剪
            userMsg('question 2'), // 可裁剪
            assistantMsg('response 3'), // 应保留（最近）
            userMsg('latest question'), // 应保留（最近）
        ];

        // 设置一个刚好能容纳保留消息 + 最新 2 条消息 + 截断标记的预算
        // 保留消息 "system prompt" = 13 字符
        // "response 3" JSON = ~26 字符, "latest question" = 15 字符
        // 截断标记预留 20
        // 预算 = 13 + 26 + 15 + 20 = ~74，设 80 留一些余量
        const budget = createBudget(80);
        const result = processor.process(messages, budget);

        // 第一条保留
        expect(result[0]).toEqual(userMsg('system prompt'));

        // 最后的消息应该被保留
        expect(result[result.length - 1]).toEqual(userMsg('latest question'));

        // 总消息数应少于原始消息数（有消息被裁剪）
        expect(result.length).toBeLessThan(messages.length);
    });

    it('inserts truncation marker when messages are trimmed', () => {
        const processor = new SlidingWindowProcessor({ reservedMessageCount: 1 });

        const messages: Message[] = [
            userMsg('first'),
            assistantMsg('aaaa'),
            userMsg('bbbb'),
            assistantMsg('cccc'),
            userMsg('last'),
        ];

        // 非常紧张的预算，迫使裁剪
        // "first" = 5, "last" = 4, 截断标记预留 20 → 最少需要 29
        // 设 40 让保留消息 + 最新 1 条 + 截断标记刚好能放下
        const budget = createBudget(40);
        const result = processor.process(messages, budget);

        // 第一条保留
        expect(result[0]).toEqual(userMsg('first'));

        // 第二条应该是截断标记
        expect(result[1].role).toBe('user');
        const markerContent = result[1].content as string;
        expect(markerContent).toContain('已被省略');

        // 最后一条是最新消息
        expect(result[result.length - 1]).toEqual(userMsg('last'));
    });

    it('always preserves the most recent messages', () => {
        const processor = new SlidingWindowProcessor({ reservedMessageCount: 1 });

        const messages: Message[] = [
            userMsg('preserved'),
            assistantMsg('old 1'),
            userMsg('old 2'),
            assistantMsg('old 3'),
            userMsg('old 4'),
            assistantMsg('recent'),
        ];

        // 预算只够保留消息 + 截断标记 + 最新 1 条
        // "preserved" = 9, assistantMsg("recent") JSON = 33, 截断标记预留 20
        // 总计 62，设 70 留一点余量
        const budget = createBudget(70);
        const result = processor.process(messages, budget);

        // 第一条（保留）和最后一条（最新）必须在
        expect(result[0]).toEqual(userMsg('preserved'));
        expect(result[result.length - 1]).toEqual(assistantMsg('recent'));

        // 中间旧消息被丢弃，只剩截断标记
        const hasMarker = result.some(
            (m) =>
                m.role === 'user' &&
                typeof m.content === 'string' &&
                m.content.includes('已被省略'),
        );
        expect(hasMarker).toBe(true);
    });
});
