/**
 * grep —— 在文件或目录中搜索正则表达式
 *
 * 递归搜索目录时自动跳过 node_modules、.git 等常见无关目录。
 * 输出格式与标准 grep 一致：文件路径:行号: 内容。
 */

import { z } from 'zod';
import { readFile as fsReadFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { tool } from '../builder.js';

// 跳过的目录
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.t-agent',
  '__pycache__',
  '.cache',
]);

export const grep = tool(
  {
    name: 'grep',
    description:
      '在文件或目录中搜索正则表达式模式。返回匹配行及其位置。',
    tags: ['readonly'],
    parameters: z.object({
      pattern: z.string().describe('正则表达式模式'),
      path: z.string().describe('搜索路径（文件或目录）'),
      include: z
        .string()
        .optional()
        .describe('文件名 glob 过滤，如 "*.ts"'),
      maxResults: z
        .number()
        .optional()
        .default(50)
        .describe('最大返回匹配数'),
    }),
  },
  async ({ pattern, path, include, maxResults }, context) => {
    const fullPath = resolve(context.cwd, path);
    const regex = new RegExp(pattern, 'gm');
    const matches: string[] = [];

    // 简单 glob 转正则（仅支持 * 通配符）
    const includeRegex = include
      ? new RegExp(
          '^' +
            include.replace(/\./g, '\\.').replace(/\*/g, '.*') +
            '$',
        )
      : null;

    async function searchFile(filePath: string) {
      if (matches.length >= maxResults) return;

      try {
        const content = await fsReadFile(filePath, 'utf-8');
        // 跳过二进制文件（含有 null byte）
        if (content.includes('\0')) return;

        const lines = content.split('\n');
        const relPath = relative(context.cwd, filePath);

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break;
          regex.lastIndex = 0; // 重置正则状态
          if (regex.test(lines[i])) {
            matches.push(`${relPath}:${i + 1}: ${lines[i].trimEnd()}`);
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    }

    async function searchDir(dir: string) {
      if (matches.length >= maxResults) return;

      try {
        const items = await readdir(dir, { withFileTypes: true });
        for (const item of items) {
          if (matches.length >= maxResults) break;

          if (item.isDirectory()) {
            if (!SKIP_DIRS.has(item.name)) {
              await searchDir(join(dir, item.name));
            }
          } else {
            if (includeRegex && !includeRegex.test(item.name)) continue;
            await searchFile(join(dir, item.name));
          }
        }
      } catch {
        // 跳过无法读取的目录
      }
    }

    // 判断路径是文件还是目录
    const pathStat = await stat(fullPath);
    if (pathStat.isDirectory()) {
      await searchDir(fullPath);
    } else {
      await searchFile(fullPath);
    }

    if (matches.length === 0) {
      return '未找到匹配项';
    }

    let result = matches.join('\n');
    if (matches.length >= maxResults) {
      result += `\n\n[已达到最大结果数 ${maxResults}，可能还有更多匹配]`;
    }
    return result;
  },
);
