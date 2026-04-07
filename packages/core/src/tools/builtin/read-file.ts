/**
 * read_file —— 读取文件内容
 *
 * 支持指定行范围读取，超长文件自动截断。
 * 输出带行号方便 LLM 精确定位和引用代码。
 */

import { z } from 'zod';
import { readFile as fsReadFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tool } from '../builder.js';

const MAX_LINES = 2000;

export const readFile = tool(
    {
        name: 'read_file',
        description: '读取文件内容。支持指定行范围。超过 2000 行时自动截断。',
        tags: ['readonly'],
        parameters: z.object({
            path: z.string().describe('文件路径（绝对或相对于工作目录）'),
            startLine: z.number().int().positive().optional().describe('起始行号（从 1 开始）'),
            endLine: z.number().int().positive().optional().describe('结束行号（含）'),
        }),
    },
    async ({ path, startLine, endLine }, context) => {
        const fullPath = resolve(context.cwd, path);
        const raw = await fsReadFile(fullPath, 'utf-8');
        let lines = raw.split('\n');

        // 行范围处理
        if (startLine || endLine) {
            const start = (startLine ?? 1) - 1;
            const end = endLine ?? lines.length;
            lines = lines.slice(start, end);
            // 带行号输出
            return lines.map((line, i) => `${start + i + 1} | ${line}`).join('\n');
        }

        // 超长截断
        if (lines.length > MAX_LINES) {
            const shown = lines.slice(0, MAX_LINES);
            const numbered = shown.map((line, i) => `${i + 1} | ${line}`).join('\n');
            return `${numbered}\n\n[文件共 ${lines.length} 行，仅显示前 ${MAX_LINES} 行。使用 startLine/endLine 参数读取特定范围。]`;
        }

        return lines.map((line, i) => `${i + 1} | ${line}`).join('\n');
    },
);
