/**
 * list_directory —— 列出目录内容
 *
 * 支持递归列出子目录，限制最大深度和条目数防止输出爆炸。
 * 目录排在文件前面，方便 LLM 快速识别项目结构。
 */

import { z } from 'zod';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tool } from '../builder.js';

const MAX_ENTRIES = 500;

export const listDirectory = tool(
  {
    name: 'list_directory',
    description: '列出目录内容。支持递归列出，限制最大深度和条目数。',
    tags: ['readonly'],
    parameters: z.object({
      path: z.string().describe('目录路径'),
      recursive: z.boolean().optional().default(false),
      maxDepth: z.number().int().min(1).max(10).optional().default(3),
    }),
  },
  async ({ path, recursive, maxDepth }, context) => {
    const fullPath = resolve(context.cwd, path);
    const entries: string[] = [];

    async function walk(dir: string, depth: number) {
      if (entries.length >= MAX_ENTRIES) return;

      const items = await readdir(dir, { withFileTypes: true });
      // 按名称排序：目录在前
      items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (entries.length >= MAX_ENTRIES) break;
        const prefix = item.isDirectory() ? '[D] ' : '[F] ';
        // 用缩进表示层级
        const indent = '  '.repeat(depth);
        entries.push(
          `${indent}${prefix}${item.name}${item.isDirectory() ? '/' : ''}`,
        );

        if (recursive && item.isDirectory() && depth < maxDepth) {
          await walk(join(dir, item.name), depth + 1);
        }
      }
    }

    await walk(fullPath, 0);

    let result = entries.join('\n');
    if (entries.length >= MAX_ENTRIES) {
      result += `\n\n[已达到最大条目数 ${MAX_ENTRIES}，部分内容未列出]`;
    }
    return result;
  },
);
