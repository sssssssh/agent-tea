/**
 * 指数退避重试工具
 *
 * 用于处理 LLM API 调用中常见的瞬态错误（如 429 限流、503 服务暂时不可用）。
 *
 * 设计特点：
 * - 指数退避：每次重试间隔翻倍（1s → 2s → 4s...），避免频繁请求加剧服务端压力
 * - 随机抖动（Jitter）：在退避基础上加随机偏移，防止多个客户端同时重试造成"惊群效应"
 * - 支持取消：通过 AbortSignal 在等待期间也能及时响应取消请求
 * - 可插拔判断：通过 isRetryable 回调决定哪些错误值得重试
 *
 * 架构位置：Core 层的 Errors 子模块，可被 Provider 实现或 Agent 层按需使用。
 */

export interface RetryOptions {
  /** 最大重试次数（默认 3） */
  maxAttempts?: number;
  /** 初始延迟毫秒数（默认 1000） */
  initialDelayMs?: number;
  /** 最大延迟毫秒数，防止退避时间过长（默认 30000） */
  maxDelayMs?: number;
  /** 抖动系数 0-1（默认 0.3，即 ±30%），用于分散并发重试 */
  jitter?: number;
  /** 判断错误是否可重试的回调，返回 false 时立即停止重试 */
  isRetryable?: (error: unknown) => boolean;
  /** 取消信号，等待期间也能响应取消 */
  signal?: AbortSignal;
  /** 每次重试前的回调，可用于记录日志 */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'signal' | 'onRetry' | 'isRetryable'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: 0.3,
};

/**
 * 带指数退避和抖动的异步重试函数。
 * fn 接收当前尝试次数（从 1 开始），方便在日志中追踪。
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // 三种情况下停止重试：已达最大次数、错误不可重试、操作已取消
      if (attempt >= opts.maxAttempts) break;
      if (opts.isRetryable && !opts.isRetryable(error)) break;
      if (opts.signal?.aborted) break;

      // 指数退避：baseDelay = initialDelay * 2^(attempt-1)，但不超过 maxDelay
      const baseDelay = Math.min(
        opts.initialDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs,
      );
      // 在 baseDelay 基础上加 ±jitter% 的随机偏移
      const jitterRange = baseDelay * opts.jitter;
      const delay = baseDelay + (Math.random() * 2 - 1) * jitterRange;

      opts.onRetry?.(attempt, error, delay);

      // 等待期间监听取消信号，确保取消操作能及时响应
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(opts.signal!.reason);
        }, { once: true });
      });
    }
  }

  // 所有重试都失败，抛出最后一个错误
  throw lastError;
}
