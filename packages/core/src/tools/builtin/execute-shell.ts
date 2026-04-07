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
                    const exitCode = error
                        ? (((error as NodeJS.ErrnoException).code as unknown as number) ?? 1)
                        : 0;

                    // 截断超长输出
                    const truncate = (s: string) => {
                        if (s.length <= MAX_OUTPUT_LENGTH) return s;
                        return (
                            s.slice(0, MAX_OUTPUT_LENGTH) +
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
