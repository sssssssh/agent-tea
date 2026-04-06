import { describe, it, expect } from 'vitest';
import { toGeminiContents, toGeminiTools } from './adapter.js';
import type { Message, ToolDefinition } from '@t-agent/core';

describe('toGeminiContents', () => {
  it('converts a simple user message', () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
    ]);
  });

  it('converts an assistant message with text (role becomes model)', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      { role: 'model', parts: [{ text: 'Hi!' }] },
    ]);
  });

  it('converts an assistant message with functionCall parts', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCallId: 'fc1',
            toolName: 'search',
            args: { query: 'weather' },
          },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'search',
              id: 'fc1',
              args: { query: 'weather' },
            },
          },
        ],
      },
    ]);
  });

  it('converts tool results as user Content with functionResponse parts', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolCallId: 'fc1', content: 'Sunny, 25C' },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: '',
              id: 'fc1',
              response: { result: 'Sunny, 25C' },
            },
          },
        ],
      },
    ]);
  });

  it('converts a multi-turn conversation', () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is 2+3?' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', toolCallId: 'fc1', toolName: 'add', args: { a: 2, b: 3 } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolCallId: 'fc1', content: '5' },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '2+3 = 5' }],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('model');
    expect(result[2].role).toBe('user');
    expect(result[3].role).toBe('model');
  });
});

describe('toGeminiTools', () => {
  it('wraps tool definitions in a single Tool with functionDeclarations', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'calculate',
        description: 'Calculate math',
        parameters: {
          type: 'object',
          properties: { expr: { type: 'string' } },
        },
      },
    ];

    const result = toGeminiTools(tools);
    // Gemini wraps all declarations in a single Tool object
    expect(result).toHaveLength(1);
    expect(result[0].functionDeclarations).toHaveLength(2);
    expect(result[0].functionDeclarations![0].name).toBe('search');
    expect(result[0].functionDeclarations![1].name).toBe('calculate');
  });
});
