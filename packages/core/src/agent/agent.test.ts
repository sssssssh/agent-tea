import { describe, it, expect } from 'vitest';
import { Agent } from './agent.js';
import { ReActAgent } from './react-agent.js';

describe('Agent backward compatibility', () => {
    it('Agent is an alias for ReActAgent', () => {
        expect(Agent).toBe(ReActAgent);
    });
});
