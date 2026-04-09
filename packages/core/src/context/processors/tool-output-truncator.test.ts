import { describe, it, expect } from 'vitest';
import { ToolOutputTruncator } from './tool-output-truncator.js';
import type { Message, ToolResultPart } from '../../llm/types.js';
import type { TokenBudget } from '../types.js';

/**
 * ToolOutputTruncator 单元测试
 *
 * 验证工具输出截断处理器的核心行为：
 * - 短输出不被修改
 * - 超长输出被截断（头尾保留、中间省略）
 * - 只影响 tool 角色的消息
 * - 其他角色的消息原样保留
 */

/** 创建一个用于测试的 TokenBudget（处理器内部未使用 budget，但接口要求传入） */
function createBudget(): TokenBudget {
    return {
        maxTokens: 100000,
        estimateTokens: (msgs: Message[]) => msgs.length * 100,
    };
}

/** 创建一条 tool 消息 */
function createToolMessage(content: string, toolCallId = 'call_1'): Message {
    return {
        role: 'tool' as const,
        content: [
            {
                type: 'tool_result' as const,
                toolCallId,
                content,
            },
        ],
    };
}

describe('ToolOutputTruncator', () => {
    const budget = createBudget();

    it('preserves short tool outputs unchanged', () => {
        const truncator = new ToolOutputTruncator({ maxOutputLength: 100, protectedTurns: 0 });
        const shortContent = 'short result';
        const messages: Message[] = [createToolMessage(shortContent)];

        const result = truncator.process(messages, budget);

        // 内容应完全保留
        const toolMsg = result[0] as { role: 'tool'; content: ToolResultPart[] };
        expect(toolMsg.content[0].content).toBe(shortContent);
    });

    it('truncates tool outputs exceeding maxLength', () => {
        const maxLen = 50;
        const truncator = new ToolOutputTruncator({
            maxOutputLength: maxLen,
            headRatio: 0.3,
            tailRatio: 0.3,
            protectedTurns: 1, // 保护最后 1 轮，目标消息在前面
        });

        const longContent = 'A'.repeat(200);
        const messages: Message[] = [
            createToolMessage(longContent, 'call_old'), // 这条会被截断
            { role: 'user', content: 'next question' },
            createToolMessage('recent', 'call_new'), // 受保护的最近轮次
        ];

        const result = truncator.process(messages, budget);
        const toolMsg = result[0] as { role: 'tool'; content: ToolResultPart[] };
        const truncatedContent = toolMsg.content[0].content;

        // 截断后内容应比原始内容短
        expect(truncatedContent.length).toBeLessThan(longContent.length);

        // 应包含截断标记
        expect(truncatedContent).toContain('已截断');

        // 头部保留 floor(50 * 0.3) = 15 个字符
        expect(truncatedContent.startsWith('A'.repeat(15))).toBe(true);

        // 尾部保留 floor(50 * 0.3) = 15 个字符
        expect(truncatedContent.endsWith('A'.repeat(15))).toBe(true);

        // 受保护的最近消息不被截断
        const recentMsg = result[2] as { role: 'tool'; content: ToolResultPart[] };
        expect(recentMsg.content[0].content).toBe('recent');
    });

    it('only affects tool role messages', () => {
        const truncator = new ToolOutputTruncator({
            maxOutputLength: 20,
            protectedTurns: 1, // 保护最后 1 轮
        });

        const longContent = 'X'.repeat(100);
        const messages: Message[] = [
            { role: 'user', content: longContent },
            createToolMessage(longContent, 'call_old'), // 不受保护，会被截断
            {
                role: 'assistant',
                content: [{ type: 'text', text: longContent }],
            },
            { role: 'user', content: 'follow up' },
            createToolMessage('short', 'call_new'), // 受保护的最近轮次
        ];

        const result = truncator.process(messages, budget);

        // user 消息不变
        expect((result[0] as { role: 'user'; content: string }).content).toBe(longContent);

        // 旧的 tool 消息被截断
        const toolMsg = result[1] as { role: 'tool'; content: ToolResultPart[] };
        expect(toolMsg.content[0].content).toContain('已截断');

        // assistant 消息不变
        const assistantMsg = result[2] as {
            role: 'assistant';
            content: Array<{ type: string; text: string }>;
        };
        expect(assistantMsg.content[0].text).toBe(longContent);
    });

    it('preserves other message types', () => {
        const truncator = new ToolOutputTruncator({
            maxOutputLength: 10,
            protectedTurns: 0,
        });

        const userMsg: Message = { role: 'user', content: 'hello world, this is a long message' };
        const assistantMsg: Message = {
            role: 'assistant',
            content: [{ type: 'text', text: 'a very long assistant response here' }],
        };

        const messages: Message[] = [userMsg, assistantMsg];
        const result = truncator.process(messages, budget);

        // 完全不修改非 tool 消息
        expect(result).toEqual(messages);
    });
});
