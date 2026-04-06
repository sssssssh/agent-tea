/**
 * 错误类型层次结构
 *
 * 采用继承体系而非错误码的设计，原因：
 * - 调用方可以按粒度捕获：catch AgentTeaError 捕获所有框架错误，
 *   或 catch ProviderError 只处理 LLM 通信相关的错误
 * - 每种错误携带特定的上下文信息（如 toolName、statusCode），
 *   便于日志记录和调试
 * - retryable 标记让 retryWithBackoff 可以自动判断是否值得重试
 *
 * 架构位置：Core 层的 Errors 子模块，被所有其他模块使用。
 */

/**
 * 框架基础错误类。
 * 所有 t-agent 的错误都继承自此类，
 * 使用方可以用 `instanceof AgentTeaError` 区分框架错误和其他错误。
 */
export class AgentTeaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentTeaError';
  }
}

/**
 * LLM Provider 通信错误。
 * 包含 HTTP 状态码和是否可重试的标记，
 * 便于上层决定是直接失败还是触发重试逻辑。
 */
export class ProviderError extends AgentTeaError {
  constructor(
    message: string,
    /** HTTP 状态码（如 429 表示限流、500 表示服务端错误） */
    public readonly statusCode?: number,
    /** 是否可重试（如 429/503 可重试，401/403 不可重试） */
    public readonly retryable: boolean = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}

/** 工具执行过程中抛出的错误，携带工具名称便于定位问题 */
export class ToolExecutionError extends AgentTeaError {
  constructor(
    message: string,
    public readonly toolName: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ToolExecutionError';
  }
}

/** 工具参数校验失败（Zod 校验不通过），携带详细的校验错误列表 */
export class ToolValidationError extends AgentTeaError {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly validationErrors: string[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ToolValidationError';
  }
}

/** Agent 循环超过最大迭代次数，属于安全保护机制触发的错误 */
export class MaxIterationsError extends AgentTeaError {
  constructor(maxIterations: number) {
    super(`Agent loop exceeded maximum iterations (${maxIterations})`);
    this.name = 'MaxIterationsError';
  }
}
