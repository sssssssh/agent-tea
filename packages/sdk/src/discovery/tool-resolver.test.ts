// packages/sdk/src/discovery/tool-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolResolver } from './tool-resolver.js';
import { readFile, grep, webFetch, tool } from '@agent-tea/core';

describe('ToolResolver', () => {
    it('resolves built-in tool names', () => {
        const resolver = new ToolResolver();

        expect(resolver.resolve('read_file')).toBe(readFile);
        expect(resolver.resolve('grep')).toBe(grep);
        expect(resolver.resolve('web_fetch')).toBe(webFetch);
    });

    it('resolves all 6 built-in tools', () => {
        const resolver = new ToolResolver();
        const names = [
            'read_file',
            'write_file',
            'list_directory',
            'execute_shell',
            'grep',
            'web_fetch',
        ];

        for (const name of names) {
            expect(resolver.resolve(name)).toBeDefined();
            expect(resolver.resolve(name)!.name).toBe(name);
        }
    });

    it('returns undefined for unknown tool name', () => {
        const resolver = new ToolResolver();
        expect(resolver.resolve('nonexistent')).toBeUndefined();
    });

    it('supports extra tools registration', () => {
        const customTool = tool(
            { name: 'custom_tool', description: 'A custom tool', parameters: z.object({}) },
            async () => 'ok',
        );

        const extras = new Map([['custom_tool', customTool]]);
        const resolver = new ToolResolver(extras);

        expect(resolver.resolve('custom_tool')).toBe(customTool);
        // 内置工具仍然可用
        expect(resolver.resolve('read_file')).toBe(readFile);
    });

    it('resolves a list of names, skipping unknown ones with warnings', () => {
        const resolver = new ToolResolver();
        const { tools, warnings } = resolver.resolveMany(['read_file', 'nonexistent', 'grep']);

        expect(tools).toHaveLength(2);
        expect(tools[0].name).toBe('read_file');
        expect(tools[1].name).toBe('grep');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('nonexistent');
    });
});
