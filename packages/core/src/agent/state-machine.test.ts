import { describe, it, expect, vi } from 'vitest';
import { AgentStateMachine } from './state-machine.js';
import type { AgentState, StateTransition } from './types.js';

const reactTransitions: StateTransition[] = [
    { from: 'idle', to: 'reacting' },
    { from: 'reacting', to: 'completed' },
    { from: 'reacting', to: 'error' },
    { from: 'reacting', to: 'aborted' },
];

describe('AgentStateMachine', () => {
    it('starts in idle state', () => {
        const sm = new AgentStateMachine(reactTransitions);
        expect(sm.current).toBe('idle');
    });

    it('allows valid transitions', () => {
        const sm = new AgentStateMachine(reactTransitions);
        sm.transition('reacting');
        expect(sm.current).toBe('reacting');

        sm.transition('completed');
        expect(sm.current).toBe('completed');
    });

    it('throws on invalid transitions', () => {
        const sm = new AgentStateMachine(reactTransitions);
        expect(() => sm.transition('completed')).toThrow(
            'Invalid state transition: idle → completed',
        );
    });

    it('supports from as array', () => {
        const transitions: StateTransition[] = [
            { from: ['idle', 'error'], to: 'reacting' },
            { from: 'reacting', to: 'completed' },
        ];
        const sm = new AgentStateMachine(transitions);

        sm.transition('reacting');
        expect(sm.current).toBe('reacting');
    });

    it('notifies listeners on transition', () => {
        const sm = new AgentStateMachine(reactTransitions);
        const listener = vi.fn();

        sm.onTransition(listener);
        sm.transition('reacting');

        expect(listener).toHaveBeenCalledWith('idle', 'reacting');
    });

    it('supports unsubscribe', () => {
        const sm = new AgentStateMachine(reactTransitions);
        const listener = vi.fn();

        const unsubscribe = sm.onTransition(listener);
        unsubscribe();

        sm.transition('reacting');
        expect(listener).not.toHaveBeenCalled();
    });

    it('respects guard conditions', () => {
        const transitions: StateTransition[] = [
            { from: 'idle', to: 'reacting', guard: () => false },
        ];
        const sm = new AgentStateMachine(transitions);

        expect(() => sm.transition('reacting')).toThrow(
            'Invalid state transition: idle → reacting',
        );
    });
});
