import { describe, it, expect } from 'vitest';
import { toOpenAIMessages, toOpenAITools } from './adapter.js';
import type { Message, ToolDefinition } from '@t-agent/core';

describe('toOpenAIMessages', () => {
  it('converts a simple user message', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('converts an assistant message with text', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there!' }],
      },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('converts an assistant message with tool calls', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool_call',
            toolCallId: 'tc1',
            toolName: 'search',
            args: { query: 'weather' },
          },
        ],
      },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"query":"weather"}',
            },
          },
        ],
      },
    ]);
  });

  it('converts tool result messages', () => {
    const messages: Message[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: 'tc1',
            content: 'Sunny, 25°C',
          },
        ],
      },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      {
        role: 'tool',
        tool_call_id: 'tc1',
        content: 'Sunny, 25°C',
      },
    ]);
  });

  it('converts a multi-turn conversation', () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is 2+3?' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_call',
            toolCallId: 'tc1',
            toolName: 'add',
            args: { a: 2, b: 3 },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolCallId: 'tc1', content: '5' },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '2+3 = 5' }],
      },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ role: 'user' });
    expect(result[1]).toMatchObject({ role: 'assistant' });
    expect(result[2]).toMatchObject({ role: 'tool' });
    expect(result[3]).toMatchObject({ role: 'assistant', content: '2+3 = 5' });
  });
});

describe('toOpenAITools', () => {
  it('converts tool definitions to OpenAI format', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ];

    const result = toOpenAITools(tools);
    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ]);
  });
});
