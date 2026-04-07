/**
 * write_file —— 写入文件内容
 *
 * 若文件已存在则覆盖，可选自动创建父目录。
 */

import { z } from 'zod';
import { writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tool } from '../builder.js';

export const writeFile = tool(
    {
        name: 'write_file',
        description: '写入文件内容。若文件已存在则覆盖。',
        tags: ['sequential'],
        parameters: z.object({
            path: z.string().describe('文件路径'),
            content: z.string().describe('写入内容'),
            createDirectories: z
                .boolean()
                .optional()
                .default(false)
                .describe('自动创建不存在的父目录'),
        }),
    },
    async ({ path, content, createDirectories }, context) => {
        const fullPath = resolve(context.cwd, path);
        if (createDirectories) {
            await mkdir(dirname(fullPath), { recursive: true });
        }
        await fsWriteFile(fullPath, content, 'utf-8');
        const bytes = Buffer.byteLength(content, 'utf-8');
        return `已写入 ${bytes} 字节到 ${fullPath}`;
    },
);
