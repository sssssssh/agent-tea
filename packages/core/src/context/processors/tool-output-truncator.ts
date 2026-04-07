/**
 * 工具输出截断处理器
 *
 * 解决的问题：工具（如文件读取、搜索）可能返回超长输出，占用大量上下文窗口。
 * 本处理器对过长的工具输出进行"头尾保留、中间截断"处理，保留关键信息的同时节省 token。
 *
 * 设计要点：
 * - 保护最近 N 轮的工具输出不被截断（最新结果通常最重要）
 * - 截断采用头尾保留策略，头部通常包含摘要/结构，尾部通常包含最新结果
 * - 非破坏性，深拷贝被修改的消息
 */

import type { Message, ToolResultPart } from '../../llm/types.js';
import type { ContextProcessor, TokenBudget } from '../types.js';

export interface ToolOutputTruncatorConfig {
    /** 单个工具输出的最大字符长度，默认 10000 */
    maxOutputLength?: number;
    /** 保留头部的比例，默认 0.3 */
    headRatio?: number;
    /** 保留尾部的比例，默认 0.3 */
    tailRatio?: number;
    /** 受保护的最近轮次数（不截断），默认 2 */
    protectedTurns?: number;
}

export class ToolOutputTruncator implements ContextProcessor {
    readonly name = 'tool_output_truncator';

    constructor(private config?: ToolOutputTruncatorConfig) {}

    process(messages: Message[], budget: TokenBudget): Message[] {
        const maxLen = this.config?.maxOutputLength ?? 10000;
        const headRatio = this.config?.headRatio ?? 0.3;
        const tailRatio = this.config?.tailRatio ?? 0.3;
        const protectedTurns = this.config?.protectedTurns ?? 2;

        // 计算受保护区域：从尾部往前数 protectedTurns 个 tool 消息
        const protectedStartIndex = this.findProtectedStartIndex(messages, protectedTurns);

        const result: Message[] = [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            // 受保护区域或非 tool 消息，直接保留
            if (i >= protectedStartIndex || msg.role !== 'tool') {
                result.push(msg);
                continue;
            }

            // 对 tool 消息中的每个 part 检查是否需要截断
            const truncatedParts = this.truncateToolParts(
                msg.content as ToolResultPart[],
                maxLen,
                headRatio,
                tailRatio,
            );

            if (truncatedParts !== null) {
                // 深拷贝被修改的消息
                result.push({ ...msg, content: truncatedParts });
            } else {
                result.push(msg);
            }
        }

        return result;
    }

    /**
     * 从尾部往前找到受保护区域的起始索引。
     * 每遇到一个 role === 'tool' 的消息算一轮。
     */
    private findProtectedStartIndex(messages: Message[], protectedTurns: number): number {
        let toolCount = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'tool') {
                toolCount++;
                if (toolCount >= protectedTurns) {
                    return i;
                }
            }
        }
        // 不够 protectedTurns 轮，全部受保护
        return 0;
    }

    /**
     * 截断过长的工具输出 part。
     * 返回新数组（如果有修改）或 null（没有修改）。
     */
    private truncateToolParts(
        parts: ToolResultPart[],
        maxLen: number,
        headRatio: number,
        tailRatio: number,
    ): ToolResultPart[] | null {
        let modified = false;
        const newParts: ToolResultPart[] = [];

        for (const part of parts) {
            if (part.content.length > maxLen) {
                const headLen = Math.floor(maxLen * headRatio);
                const tailLen = Math.floor(maxLen * tailRatio);
                const omitted = part.content.length - headLen - tailLen;
                const truncated =
                    part.content.slice(0, headLen) +
                    `\n[... 已截断 ${omitted} 字符 ...]\n` +
                    part.content.slice(-tailLen);
                newParts.push({ ...part, content: truncated });
                modified = true;
            } else {
                newParts.push(part);
            }
        }

        return modified ? newParts : null;
    }
}
