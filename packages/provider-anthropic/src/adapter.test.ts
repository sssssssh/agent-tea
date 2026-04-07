import { describe, it, expect } from 'vitest';
import { toAnthropicMessages, toAnthropicTools } from './adapter.js';
import type { Message, ToolDefinition } from '@agent-tea/core';

describe('toAnthropicMessages', () => {
    it('converts a simple user message', () => {
        const messages: Message[] = [{ role: 'user', content: 'Hello' }];
        const result = toAnthropicMessages(messages);
        expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('converts an assistant message with text', () => {
        const messages: Message[] = [
            { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
        ];
        const result = toAnthropicMessages(messages);
        expect(result).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] }]);
    });

    it('converts an assistant message with tool_use blocks', () => {
        const messages: Message[] = [
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Let me search.' },
                    {
                        type: 'tool_call',
                        toolCallId: 'tu1',
                        toolName: 'search',
                        args: { query: 'weather' },
                    },
                ],
            },
        ];
        const result = toAnthropicMessages(messages);
        expect(result).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Let me search.' },
                    {
                        type: 'tool_use',
                        id: 'tu1',
                        name: 'search',
                        input: { query: 'weather' },
                    },
                ],
            },
        ]);
    });

    it('converts tool results as user messages with tool_result blocks', () => {
        const messages: Message[] = [
            {
                role: 'tool',
                content: [{ type: 'tool_result', toolCallId: 'tu1', content: 'Sunny' }],
            },
        ];
        const result = toAnthropicMessages(messages);
        // Anthropic: tool results go in a user message
        expect(result).toEqual([
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'tu1',
                        content: 'Sunny',
                        is_error: false,
                    },
                ],
            },
        ]);
    });

    it('converts tool error results with is_error flag', () => {
        const messages: Message[] = [
            {
                role: 'tool',
                content: [
                    {
                        type: 'tool_result',
                        toolCallId: 'tu1',
                        content: 'Not found',
                        isError: true,
                    },
                ],
            },
        ];
        const result = toAnthropicMessages(messages);
        expect(result).toEqual([
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'tu1',
                        content: 'Not found',
                        is_error: true,
                    },
                ],
            },
        ]);
    });
});

describe('toAnthropicTools', () => {
    it('converts tool definitions with input_schema', () => {
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
        ];
        const result = toAnthropicTools(tools);
        expect(result).toEqual([
            {
                name: 'search',
                description: 'Search the web',
                input_schema: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    required: ['query'],
                },
            },
        ]);
    });
});
