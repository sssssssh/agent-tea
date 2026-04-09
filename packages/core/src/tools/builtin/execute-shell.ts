/**
 * execute_shell —— 执行 shell 命令
 *
 * 返回 stdout、stderr 和退出码。超长输出自动截断。
 * 即使命令失败也不标记 isError，让 LLM 自己判断是否需要处理。
 */

import { z } from 'zod';
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { tool } from '../builder.js';
import { safeTruncate } from '../../utils/safe-truncate.js';

const MAX_OUTPUT_LENGTH = 50000;

export const executeShell = tool(
    {
        name: 'execute_shell',
        description: '执行 shell 命令。返回 stdout、stderr 和退出码。',
        tags: ['sequential'],
        parameters: z.object({
            command: z.string().describe('要执行的 shell 命令'),
            cwd: z.string().optional().describe('工作目录（默认为当前工作目录）'),
            timeout: z.number().optional().default(30000).describe('超时毫秒数'),
        }),
    },
    async ({ command, cwd, timeout }, context) => {
        const workDir = cwd ? resolve(context.cwd, cwd) : context.cwd;

        return new Promise<string>((promiseResolve) => {
            exec(
                command,
                {
                    cwd: workDir,
                    timeout,
                    maxBuffer: 10 * 1024 * 1024, // 10MB
                    signal: context.signal,
                },
                (error, stdout, stderr) => {
                    // 安全提取退出码：优先用 exec 回调的标准 error 属性
                    let exitCode = 0;
                    if (error) {
                        // exec 的 error 对象有 code (退出码数字) 或 killed/signal 等属性
                        // 注意 NodeJS.ErrnoException.code 是 string (如 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
                        // 而 ExecException 额外有 number 类型的退出码在 error.code 中（但类型定义不准确）
                        const status = (error as { status?: number }).status;
                        const code = (error as { code?: string | number }).code;
                        if (typeof status === 'number') {
                            exitCode = status;
                        } else if (typeof code === 'number') {
                            exitCode = code;
                        } else {
                            exitCode = 1;
                        }
                    }

                    // 截断超长输出
                    const truncate = (s: string) => {
                        if (s.length <= MAX_OUTPUT_LENGTH) return s;
                        return (
                            safeTruncate(s, MAX_OUTPUT_LENGTH) +
                            `\n[... 输出已截断，共 ${s.length} 字符 ...]`
                        );
                    };

                    let result = '';
                    if (stdout) result += `stdout:\n${truncate(stdout)}\n`;
                    if (stderr) result += `stderr:\n${truncate(stderr)}\n`;
                    result += `exit_code: ${exitCode}`;

                    promiseResolve(result);
                },
            );
        });
    },
);
