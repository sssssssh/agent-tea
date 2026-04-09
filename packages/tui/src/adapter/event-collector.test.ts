import { describe, it, expect } from 'vitest';
import { createEventCollector } from './event-collector.js';
import { mockAgentRun } from '../test-utils.js';
import type { AgentEvent } from '@agent-tea/sdk';

describe('createEventCollector', () => {
    const basicEvents: AgentEvent[] = [
        { type: 'agent_start', sessionId: 's1' },
        { type: 'message', role: 'assistant', content: '你好' },
        { type: 'usage', model: 'gpt-4o', usage: { inputTokens: 10, outputTokens: 5 } },
        { type: 'agent_end', sessionId: 's1', reason: 'complete' },
    ];

    it('should return final snapshot on start()', async () => {
        const agent = mockAgentRun(basicEvents);
        const collector = createEventCollector(agent as any, '你好');
        const snapshot = await collector.start();

        expect(snapshot.status).toBe('completed');
        expect(snapshot.history).toHaveLength(1);
        expect(snapshot.history[0]).toMatchObject({
            type: 'message',
            role: 'assistant',
            content: '你好',
        });
        expect(snapshot.history[0].id).toBeTypeOf('number');
        expect(snapshot.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('should emit snapshot events', async () => {
        const agent = mockAgentRun(basicEvents);
        const collector = createEventCollector(agent as any, '你好');
        const snapshots: any[] = [];
        collector.on('snapshot', (s) => snapshots.push({ ...s }));
        await collector.start();

        expect(snapshots.length).toBe(4);
        expect(snapshots[0].status).toBe('thinking');
    });

    it('should handle tool request/response pair', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'tool_request', requestId: 'r1', toolName: 'readFile', args: { path: 'a.ts' } },
            {
                type: 'tool_response',
                requestId: 'r1',
                toolName: 'readFile',
                content: 'file content',
            },
            { type: 'message', role: 'assistant', content: '读完了' },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, '读文件');
        const snapshot = await collector.start();

        expect(snapshot.history).toHaveLength(2);
        const toolCall = snapshot.history[0];
        expect(toolCall.type).toBe('tool_call');
        if (toolCall.type === 'tool_call') {
            expect(toolCall.name).toBe('readFile');
            expect(toolCall.result).toBe('file content');
            expect(toolCall.isError).toBe(false);
        }
    });

    it('should handle error events', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'error', message: 'something broke', fatal: true },
            { type: 'agent_end', sessionId: 's1', reason: 'error' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, '失败');
        const snapshot = await collector.start();

        expect(snapshot.status).toBe('error');
        expect(snapshot.error).toBe('something broke');
        expect(snapshot.history).toHaveLength(1);
        expect(snapshot.history[0]).toMatchObject({
            type: 'error',
            message: 'something broke',
            fatal: true,
        });
        expect(snapshot.history[0].id).toBeTypeOf('number');
    });

    it('should handle plan events', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            {
                type: 'plan_created',
                plan: {
                    id: 'p1',
                    filePath: '/tmp/plan.json',
                    steps: [
                        { index: 0, description: 'Step 1', status: 'pending' },
                        { index: 1, description: 'Step 2', status: 'pending' },
                    ],
                    rawContent: '',
                    createdAt: new Date(),
                },
                filePath: '/tmp/plan.json',
            },
            { type: 'step_start', step: { index: 0, description: 'Step 1', status: 'executing' } },
            {
                type: 'step_complete',
                step: {
                    index: 0,
                    description: 'Step 1',
                    status: 'completed',
                    result: { summary: 'done', toolCallCount: 1 },
                },
            },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, '计划');
        const snapshot = await collector.start();

        const planItem = snapshot.history.find((h) => h.type === 'plan');
        expect(planItem).toBeDefined();
        if (planItem?.type === 'plan') {
            expect(planItem.steps[0].status).toBe('completed');
        }
    });

    it('should flush streaming text when non-message event arrives', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'message', role: 'assistant', content: '正在思考' },
            { type: 'tool_request', requestId: 'r1', toolName: 'grep', args: { pattern: 'foo' } },
            { type: 'tool_response', requestId: 'r1', toolName: 'grep', content: 'found' },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, 'test');
        const snapshots: any[] = [];
        collector.on('snapshot', (s) => snapshots.push({ ...s, history: [...s.history] }));
        await collector.start();

        // message 事件后，文本在 streaming 中
        const afterMessage = snapshots[1];
        expect(afterMessage.streaming).toBe('正在思考');

        // tool_request 事件触发 flushStreaming，文本转入 history
        const afterToolReq = snapshots[2];
        expect(afterToolReq.streaming).toBeNull();
        expect(afterToolReq.history[0]).toMatchObject({
            type: 'message',
            role: 'assistant',
            content: '正在思考',
        });
    });

    it('should support abort()', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'message', role: 'assistant', content: '长回复...' },
            { type: 'agent_end', sessionId: 's1', reason: 'abort' },
        ];
        const agent = mockAgentRun(events);
        const collector = createEventCollector(agent as any, 'test');
        collector.abort();
        const snapshot = await collector.start();
        expect(snapshot.status).toBe('aborted');
    });
});
