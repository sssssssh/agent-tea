import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolExecutor } from './executor.js';
import { ToolRegistry } from '../tools/registry.js';
import { tool } from '../tools/builder.js';
import type { ToolContext } from '../tools/types.js';

function createContext(overrides?: Partial<ToolContext>): ToolContext {
    return {
        sessionId: 'test-session',
        cwd: '/tmp',
        messages: [],
        signal: new AbortController().signal,
        ...overrides,
    };
}

describe('ToolExecutor', () => {
    describe('timeout', () => {
        it('times out a slow tool with global timeout', async () => {
            const slowTool = tool(
                { name: 'slow', description: 'A slow tool', parameters: z.object({}) },
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    return 'done';
                },
            );

            const registry = new ToolRegistry();
            registry.register(slowTool);
            const executor = new ToolExecutor(registry);

            const result = await executor.execute(
                { id: '1', name: 'slow', args: {} },
                createContext(),
                100,
            );

            expect(result.result.isError).toBe(true);
            expect(result.result.content).toContain('timed out');
            expect(result.result.content).toContain('100ms');
        });

        it('uses tool-level timeout over global timeout', async () => {
            const slowTool = tool(
                { name: 'slow', description: 'A slow tool', parameters: z.object({}), timeout: 50 },
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                    return 'done';
                },
            );

            const registry = new ToolRegistry();
            registry.register(slowTool);
            const executor = new ToolExecutor(registry);

            const result = await executor.execute(
                { id: '1', name: 'slow', args: {} },
                createContext(),
                10000,
            );

            expect(result.result.isError).toBe(true);
            expect(result.result.content).toContain('timed out');
        });

        it('does not timeout a fast tool', async () => {
            const fastTool = tool(
                { name: 'fast', description: 'A fast tool', parameters: z.object({}) },
                async () => 'quick result',
            );

            const registry = new ToolRegistry();
            registry.register(fastTool);
            const executor = new ToolExecutor(registry);

            const result = await executor.execute(
                { id: '1', name: 'fast', args: {} },
                createContext(),
                5000,
            );

            expect(result.result.isError).toBeUndefined();
            expect(result.result.content).toBe('quick result');
        });

        it('skips timeout when globalTimeout is 0', async () => {
            const slowTool = tool(
                { name: 'slow', description: 'A slow tool', parameters: z.object({}) },
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    return 'done';
                },
            );

            const registry = new ToolRegistry();
            registry.register(slowTool);
            const executor = new ToolExecutor(registry);

            const result = await executor.execute(
                { id: '1', name: 'slow', args: {} },
                createContext(),
                0,
            );

            expect(result.result.isError).toBeUndefined();
            expect(result.result.content).toBe('done');
        });
    });
});
