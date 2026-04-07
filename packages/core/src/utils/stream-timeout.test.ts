import { describe, it, expect } from 'vitest';
import { withStreamTimeout } from './stream-timeout.js';
import { TimeoutError } from '../errors/errors.js';

async function* delayedStream<T>(events: { value: T; delayMs: number }[]): AsyncGenerator<T> {
    for (const event of events) {
        await new Promise((resolve) => setTimeout(resolve, event.delayMs));
        yield event.value;
    }
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const results: T[] = [];
    for await (const item of gen) {
        results.push(item);
    }
    return results;
}

describe('withStreamTimeout', () => {
    it('passes through events from a normal stream', async () => {
        const stream = delayedStream([
            { value: 'a', delayMs: 10 },
            { value: 'b', delayMs: 10 },
            { value: 'c', delayMs: 10 },
        ]);
        const wrapped = withStreamTimeout(stream, { connectionMs: 1000, streamStallMs: 1000 });
        const results = await collect(wrapped);
        expect(results).toEqual(['a', 'b', 'c']);
    });

    // 上游延迟 500ms，connectionMs 仅 50ms，超时会在 50ms 时抛出；
    // 给测试整体留 2s 余量（含上游 timer 自然到期）
    it('throws TimeoutError with llm_connection phase when no event arrives', async () => {
        const stream = delayedStream([{ value: 'a', delayMs: 500 }]);
        const wrapped = withStreamTimeout(stream, { connectionMs: 50, streamStallMs: 1000 });

        try {
            await collect(wrapped);
            expect.fail('Should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(TimeoutError);
            expect((error as TimeoutError).phase).toBe('llm_connection');
            expect((error as TimeoutError).timeoutMs).toBe(50);
        }
    }, 2000);

    // 上游第二个事件延迟 500ms，streamStallMs 仅 50ms，超时会在 50ms 时抛出
    it('throws TimeoutError with llm_stream phase when stream stalls', async () => {
        const stream = delayedStream([
            { value: 'a', delayMs: 10 },
            { value: 'b', delayMs: 500 },
        ]);
        const wrapped = withStreamTimeout(stream, { connectionMs: 1000, streamStallMs: 50 });

        try {
            await collect(wrapped);
            expect.fail('Should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(TimeoutError);
            expect((error as TimeoutError).phase).toBe('llm_stream');
            expect((error as TimeoutError).timeoutMs).toBe(50);
        }
    }, 2000);

    it('resets stall timer on each event', async () => {
        const stream = delayedStream([
            { value: 'a', delayMs: 10 },
            { value: 'b', delayMs: 40 },
            { value: 'c', delayMs: 40 },
            { value: 'd', delayMs: 40 },
        ]);
        const wrapped = withStreamTimeout(stream, { connectionMs: 1000, streamStallMs: 60 });
        const results = await collect(wrapped);
        expect(results).toEqual(['a', 'b', 'c', 'd']);
    });
});
