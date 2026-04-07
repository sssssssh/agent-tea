/**
 * web_fetch —— 获取 URL 内容
 *
 * 仅支持 GET 请求。对 HTML 页面会做简单的标签清理，
 * 提取纯文本内容供 LLM 阅读。超长内容自动截断。
 */

import { z } from 'zod';
import { tool } from '../builder.js';

const DEFAULT_MAX_LENGTH = 50000;
const TIMEOUT_MS = 10000;

export const webFetch = tool(
  {
    name: 'web_fetch',
    description:
      '获取 URL 的文本内容（仅 GET 请求）。对 HTML 页面会尝试提取纯文本。',
    tags: ['readonly'],
    parameters: z.object({
      url: z.string().url().describe('要获取的 URL'),
      maxLength: z
        .number()
        .optional()
        .default(DEFAULT_MAX_LENGTH)
        .describe('最大返回字符数'),
    }),
  },
  async ({ url, maxLength }, context) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // 合并外部取消信号
    context.signal.addEventListener('abort', () => controller.abort(), {
      once: true,
    });

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'agent-tea/1.0' },
      });

      if (!response.ok) {
        return {
          content: `HTTP ${response.status}: ${response.statusText}`,
          isError: true,
        };
      }

      let text = await response.text();

      // 简单 HTML 标签清理
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) {
        // 移除 script 和 style 标签及内容
        text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
        // 移除所有 HTML 标签
        text = text.replace(/<[^>]+>/g, ' ');
        // 清理多余空白
        text = text.replace(/\s+/g, ' ').trim();
      }

      if (text.length > maxLength) {
        text =
          text.slice(0, maxLength) +
          `\n[... 内容已截断，共 ${text.length} 字符 ...]`;
      }

      return text;
    } finally {
      clearTimeout(timeout);
    }
  },
);
