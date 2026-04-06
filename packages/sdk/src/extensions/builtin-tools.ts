/**
 * 内置工具扩展 -- 一行代码引入全部基础工具
 */

import { extension } from '../extension.js';
import {
  readFile,
  writeFile,
  listDirectory,
  executeShell,
  grep,
  webFetch,
} from '@t-agent/core';

export const builtinTools = extension({
  name: 'builtin-tools',
  description:
    '文件操作、shell 执行、代码搜索和网页获取的基础工具集',
  instructions:
    '你有文件读写、shell 执行、代码搜索和网页获取能力。优先用 grep 搜索定位，再用 read_file 精读相关部分。写文件前先读取确认当前内容。',
  tools: [readFile, writeFile, listDirectory, executeShell, grep, webFetch],
});
