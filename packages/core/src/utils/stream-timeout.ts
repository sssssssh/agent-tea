import { TimeoutError } from '../errors/errors.js';

/** 流超时配置 */
export interface StreamTimeoutConfig {
    /** 等待第一个事件的最大时间（毫秒） */
    connectionMs: number;
    /** 相邻两个事件之间允许的最大间隔（毫秒） */
    streamStallMs: number;
}

/**
 * 用两阶段超时逻辑包装 AsyncGenerator：
 * - 连接阶段：等待第一个事件不得超过 connectionMs
 * - 流式阶段：相邻事件间隔不得超过 streamStallMs
 *
 * 超时时抛出 TimeoutError 并调用 iterator.return() 终止上游生成器。
 */
export async function* withStreamTimeout<T>(
    stream: AsyncGenerator<T>,
    config: StreamTimeoutConfig,
): AsyncGenerator<T> {
    const iterator = stream[Symbol.asyncIterator]();
    let firstEventReceived = false;

    try {
        while (true) {
            // 根据当前阶段决定超时时长和错误类型
            const timeoutMs = firstEventReceived ? config.streamStallMs : config.connectionMs;
            const phase = firstEventReceived ? 'llm_stream' : 'llm_connection';

            // 创建超时 Promise，超时时 reject
            let timerId: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timerId = setTimeout(() => {
                    reject(
                        new TimeoutError(
                            phase === 'llm_connection'
                                ? `LLM 连接超时：${timeoutMs}ms 内未收到第一个事件`
                                : `LLM 流式响应停滞：${timeoutMs}ms 内未收到新事件`,
                            timeoutMs,
                            phase,
                        ),
                    );
                }, timeoutMs);
            });

            let result: IteratorResult<T>;
            try {
                // 竞争：等待下一个事件 vs 超时
                result = await Promise.race([iterator.next(), timeoutPromise]);
            } catch (err) {
                // 超时或其他错误：终止上游生成器后重新抛出
                await iterator.return?.(undefined);
                throw err;
            } finally {
                // 无论成功还是失败，及时清除定时器
                clearTimeout(timerId!);
            }

            if (result.done) {
                return;
            }

            firstEventReceived = true;
            yield result.value;
        }
    } finally {
        // 确保上游生成器被终止（应对外部 break/throw 等情况）
        await iterator.return?.(undefined);
    }
}
