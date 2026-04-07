/**
 * tool() 工厂函数 —— 创建工具的推荐方式
 *
 * 为什么需要工厂函数而不是直接实现 Tool 接口？
 * 1. 自动处理字符串返回值的包装，减少样板代码
 * 2. 通过泛型约束，让 execute 函数的参数类型从 Zod Schema 自动推导
 * 3. 提供统一的创建入口，未来可在此添加校验、中间件等逻辑
 *
 * 架构位置：Core 层的 Tool 子模块，是开发者定义工具的主要 API。
 *
 * @example
 * ```typescript
 * const greetTool = tool({
 *   name: 'greet',
 *   description: 'Greet someone',
 *   parameters: z.object({ name: z.string() }),
 * }, async ({ name }) => {
 *   return `Hello, ${name}!`;
 * });
 * ```
 */

import type { ZodType, z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

/** 工具执行函数的类型签名 */
type ToolExecuteFn<TParams> = (
  params: TParams,
  context: ToolContext,
) => Promise<ToolResult | string>;

/** 工具配置，泛型 T 绑定 Zod Schema 以实现参数类型推导 */
interface ToolConfig<T extends ZodType> {
  name: string;
  description: string;
  parameters: T;
  tags?: string[];
  timeout?: number;
}

/**
 * 创建一个类型安全的工具。
 * 泛型链路：ToolConfig.parameters (ZodType T) → z.infer<T> → execute 参数类型
 * 这样开发者定义 parameters 后，execute 函数的参数类型自动推导，无需手动标注。
 */
export function tool<T extends ZodType>(
  config: ToolConfig<T>,
  execute: ToolExecuteFn<z.infer<T>>,
): Tool<z.infer<T>> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    tags: config.tags,
    timeout: config.timeout,
    async execute(params, context) {
      const result = await execute(params, context);
      // 允许简单工具直接返回字符串，自动包装为 ToolResult
      if (typeof result === 'string') {
        return { content: result };
      }
      return result;
    },
  };
}
