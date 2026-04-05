import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { tool } from './builder.js';
import type { ToolContext } from './types.js';

const mockContext: ToolContext = {
  sessionId: 'test-session',
  cwd: '/tmp',
  messages: [],
  signal: new AbortController().signal,
};

describe('tool()', () => {
  it('creates a tool with the correct name and description', () => {
    const greet = tool(
      {
        name: 'greet',
        description: 'Greet someone',
        parameters: z.object({ name: z.string() }),
      },
      async ({ name }) => `Hello, ${name}!`,
    );

    expect(greet.name).toBe('greet');
    expect(greet.description).toBe('Greet someone');
  });

  it('wraps string return value as ToolResult', async () => {
    const greet = tool(
      {
        name: 'greet',
        description: 'Greet someone',
        parameters: z.object({ name: z.string() }),
      },
      async ({ name }) => `Hello, ${name}!`,
    );

    const result = await greet.execute({ name: 'World' }, mockContext);
    expect(result).toEqual({ content: 'Hello, World!' });
  });

  it('passes through ToolResult objects directly', async () => {
    const greet = tool(
      {
        name: 'greet',
        description: 'Greet someone',
        parameters: z.object({ name: z.string() }),
      },
      async ({ name }) => ({
        content: `Hello, ${name}!`,
        data: { greeted: name },
      }),
    );

    const result = await greet.execute({ name: 'Alice' }, mockContext);
    expect(result).toEqual({
      content: 'Hello, Alice!',
      data: { greeted: 'Alice' },
    });
  });

  it('preserves Zod schema on the tool for validation', () => {
    const schema = z.object({ count: z.number().min(1) });
    const counter = tool(
      {
        name: 'counter',
        description: 'Count',
        parameters: schema,
      },
      async ({ count }) => `Counted to ${count}`,
    );

    // Schema should validate correctly
    expect(counter.parameters.safeParse({ count: 5 }).success).toBe(true);
    expect(counter.parameters.safeParse({ count: 0 }).success).toBe(false);
    expect(counter.parameters.safeParse({ count: 'x' }).success).toBe(false);
  });

  it('provides context to execute function', async () => {
    const echo = tool(
      {
        name: 'echo',
        description: 'Echo with cwd',
        parameters: z.object({ text: z.string() }),
      },
      async ({ text }, ctx) => `[${ctx.cwd}] ${text}`,
    );

    const result = await echo.execute({ text: 'hi' }, mockContext);
    expect(result).toEqual({ content: '[/tmp] hi' });
  });
});
