import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Scheduler } from './scheduler.js';
import { ToolRegistry } from '../tools/registry.js';
import { tool } from '../tools/builder.js';
import type { ToolContext } from '../tools/types.js';
import type { ToolCallRequest } from './executor.js';

function createContext(overrides?: Partial<ToolContext>): ToolContext {
    return {
        sessionId: 'test-session',
        cwd: '/tmp',
        messages: [],
        signal: new AbortController().signal,
        ...overrides,
    };
}

/** 收集 AsyncGenerator 的所有结果 */
async function collectResults(gen: AsyncGenerator<unknown>) {
    const results: unknown[] = [];
    for await (const item of gen) {
        results.push(item);
    }
    return results;
}

describe('Scheduler', () => {
    it('executes single tool call', async () => {
        const echoTool = tool(
            { name: 'echo', description: 'Echo input', parameters: z.object({ text: z.string() }) },
            async ({ text }) => text,
        );

        const registry = new ToolRegistry();
        registry.register(echoTool);
        const scheduler = new Scheduler(registry);

        const requests: ToolCallRequest[] = [{ id: '1', name: 'echo', args: { text: 'hello' } }];

        const results = await collectResults(scheduler.execute(requests, createContext()));

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            id: '1',
            name: 'echo',
            result: { content: 'hello' },
        });
    });

    it('executes parallel tools concurrently', async () => {
        // 用执行顺序记录来验证并行：所有工具应在任何一个完成前全部启动
        const executionLog: string[] = [];

        const slowA = tool(
            { name: 'slow_a', description: 'Slow A', parameters: z.object({}) },
            async () => {
                executionLog.push('start_a');
                await new Promise((r) => setTimeout(r, 50));
                executionLog.push('end_a');
                return 'result_a';
            },
        );

        const slowB = tool(
            { name: 'slow_b', description: 'Slow B', parameters: z.object({}) },
            async () => {
                executionLog.push('start_b');
                await new Promise((r) => setTimeout(r, 50));
                executionLog.push('end_b');
                return 'result_b';
            },
        );

        const registry = new ToolRegistry();
        registry.register(slowA);
        registry.register(slowB);
        const scheduler = new Scheduler(registry);

        const requests: ToolCallRequest[] = [
            { id: '1', name: 'slow_a', args: {} },
            { id: '2', name: 'slow_b', args: {} },
        ];

        const results = await collectResults(scheduler.execute(requests, createContext()));

        expect(results).toHaveLength(2);
        // 并行执行：两个工具应该先全部启动，再全部结束
        expect(executionLog[0]).toBe('start_a');
        expect(executionLog[1]).toBe('start_b');
        // 结果保持请求顺序
        expect(results[0]).toMatchObject({ id: '1', name: 'slow_a' });
        expect(results[1]).toMatchObject({ id: '2', name: 'slow_b' });
    });

    it('executes sequential-tagged tools one at a time', async () => {
        const executionLog: string[] = [];

        const seqA = tool(
            {
                name: 'seq_a',
                description: 'Sequential A',
                parameters: z.object({}),
                tags: ['sequential'],
            },
            async () => {
                executionLog.push('start_a');
                await new Promise((r) => setTimeout(r, 30));
                executionLog.push('end_a');
                return 'a';
            },
        );

        const seqB = tool(
            {
                name: 'seq_b',
                description: 'Sequential B',
                parameters: z.object({}),
                tags: ['sequential'],
            },
            async () => {
                executionLog.push('start_b');
                await new Promise((r) => setTimeout(r, 30));
                executionLog.push('end_b');
                return 'b';
            },
        );

        const registry = new ToolRegistry();
        registry.register(seqA);
        registry.register(seqB);
        const scheduler = new Scheduler(registry);

        const requests: ToolCallRequest[] = [
            { id: '1', name: 'seq_a', args: {} },
            { id: '2', name: 'seq_b', args: {} },
        ];

        const results = await collectResults(scheduler.execute(requests, createContext()));

        expect(results).toHaveLength(2);
        // 顺序执行：第一个完成后第二个才启动
        expect(executionLog).toEqual(['start_a', 'end_a', 'start_b', 'end_b']);
    });

    it('handles mixed sequential and parallel groups', async () => {
        const executionLog: string[] = [];

        const paraA = tool(
            { name: 'para_a', description: 'Parallel A', parameters: z.object({}) },
            async () => {
                executionLog.push('start_para_a');
                await new Promise((r) => setTimeout(r, 30));
                executionLog.push('end_para_a');
                return 'pa';
            },
        );

        const paraB = tool(
            { name: 'para_b', description: 'Parallel B', parameters: z.object({}) },
            async () => {
                executionLog.push('start_para_b');
                await new Promise((r) => setTimeout(r, 30));
                executionLog.push('end_para_b');
                return 'pb';
            },
        );

        const seqC = tool(
            {
                name: 'seq_c',
                description: 'Sequential C',
                parameters: z.object({}),
                tags: ['sequential'],
            },
            async () => {
                executionLog.push('start_seq_c');
                await new Promise((r) => setTimeout(r, 10));
                executionLog.push('end_seq_c');
                return 'sc';
            },
        );

        const paraD = tool(
            { name: 'para_d', description: 'Parallel D', parameters: z.object({}) },
            async () => {
                executionLog.push('start_para_d');
                await new Promise((r) => setTimeout(r, 10));
                executionLog.push('end_para_d');
                return 'pd';
            },
        );

        const registry = new ToolRegistry();
        registry.register(paraA);
        registry.register(paraB);
        registry.register(seqC);
        registry.register(paraD);
        const scheduler = new Scheduler(registry);

        // 请求顺序：para_a, para_b（并行组）, seq_c（顺序组）, para_d（并行组）
        const requests: ToolCallRequest[] = [
            { id: '1', name: 'para_a', args: {} },
            { id: '2', name: 'para_b', args: {} },
            { id: '3', name: 'seq_c', args: {} },
            { id: '4', name: 'para_d', args: {} },
        ];

        const results = await collectResults(scheduler.execute(requests, createContext()));

        expect(results).toHaveLength(4);

        // 验证分组执行顺序：
        // 第一组（并行）：para_a 和 para_b 同时启动
        expect(executionLog.indexOf('start_para_a')).toBeLessThan(
            executionLog.indexOf('start_seq_c'),
        );
        expect(executionLog.indexOf('start_para_b')).toBeLessThan(
            executionLog.indexOf('start_seq_c'),
        );

        // 第二组（顺序）：seq_c 在并行组完成后执行
        expect(executionLog.indexOf('end_para_a')).toBeLessThan(
            executionLog.indexOf('start_seq_c'),
        );
        expect(executionLog.indexOf('end_para_b')).toBeLessThan(
            executionLog.indexOf('start_seq_c'),
        );

        // 第三组（并行）：para_d 在 seq_c 完成后执行
        expect(executionLog.indexOf('end_seq_c')).toBeLessThan(
            executionLog.indexOf('start_para_d'),
        );

        // 结果按请求顺序返回
        expect(results.map((r: any) => r.id)).toEqual(['1', '2', '3', '4']);
    });

    it('executeSingle executes a single tool request', async () => {
        const addTool = tool(
            {
                name: 'add',
                description: 'Add two numbers',
                parameters: z.object({ a: z.number(), b: z.number() }),
            },
            async ({ a, b }) => String(a + b),
        );

        const registry = new ToolRegistry();
        registry.register(addTool);
        const scheduler = new Scheduler(registry);

        const result = await scheduler.executeSingle(
            { id: 'single-1', name: 'add', args: { a: 3, b: 7 } },
            createContext(),
        );

        expect(result).toMatchObject({
            id: 'single-1',
            name: 'add',
            result: { content: '10' },
        });
    });
});
