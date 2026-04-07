import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { AgentTUI } from './AgentTUI.js';
import { mockAgentRun } from '../test-utils.js';
import type { AgentEvent } from '@agent-tea/sdk';

describe('AgentTUI', () => {
    it('should render initial idle state', () => {
        const agent = mockAgentRun([]);
        const { lastFrame } = render(<AgentTUI agent={agent as any} />);
        expect(lastFrame()).toContain('idle');
    });

    it('should render agent response after initialQuery', async () => {
        const events: AgentEvent[] = [
            { type: 'agent_start', sessionId: 's1' },
            { type: 'message', role: 'assistant', content: '你好！' },
            { type: 'agent_end', sessionId: 's1', reason: 'complete' },
        ];
        const agent = mockAgentRun(events);
        const { lastFrame } = render(
            <AgentTUI agent={agent as any} initialQuery="你好" />,
        );

        await new Promise((r) => setTimeout(r, 100));
        const frame = lastFrame();
        expect(frame).toContain('你好！');
    });
});
