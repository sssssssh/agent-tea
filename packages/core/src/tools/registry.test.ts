import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { tool } from './builder.js';
import { ToolRegistry } from './registry.js';

function makeTool(name: string) {
    return tool(
        {
            name,
            description: `Tool ${name}`,
            parameters: z.object({ input: z.string() }),
        },
        async ({ input }) => input,
    );
}

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    it('registers and retrieves a tool', () => {
        const t = makeTool('foo');
        registry.register(t);

        expect(registry.get('foo')).toBe(t);
        expect(registry.has('foo')).toBe(true);
        expect(registry.size).toBe(1);
    });

    it('throws on duplicate registration', () => {
        registry.register(makeTool('foo'));
        expect(() => registry.register(makeTool('foo'))).toThrow(
            'Tool "foo" is already registered',
        );
    });

    it('unregisters a tool', () => {
        registry.register(makeTool('foo'));
        expect(registry.unregister('foo')).toBe(true);
        expect(registry.has('foo')).toBe(false);
        expect(registry.unregister('foo')).toBe(false);
    });

    it('returns all tools', () => {
        registry.register(makeTool('a'));
        registry.register(makeTool('b'));

        const all = registry.getAll();
        expect(all).toHaveLength(2);
        expect(registry.getNames()).toEqual(['a', 'b']);
    });

    it('converts tools to JSON Schema definitions', () => {
        registry.register(makeTool('greet'));

        const defs = registry.toToolDefinitions();
        expect(defs).toHaveLength(1);
        expect(defs[0].name).toBe('greet');
        expect(defs[0].description).toBe('Tool greet');
        expect(defs[0].parameters).toHaveProperty('type', 'object');
        expect(defs[0].parameters).toHaveProperty('properties');
    });

    it('clears all tools', () => {
        registry.register(makeTool('a'));
        registry.register(makeTool('b'));
        registry.clear();

        expect(registry.size).toBe(0);
        expect(registry.getAll()).toEqual([]);
    });
});
