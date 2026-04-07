/**
 * Extension —— 可复用的能力包
 *
 * Extension 将工具、技能和指令打包为一个可复用单元，
 * 类似插件系统中的"插件"概念。
 *
 * 设计意图：
 * - 组织性：将相关的工具和技能按领域分组（如"天气"、"代码审查"）
 * - 可复用性：同一个 Extension 可以被多个 Agent 共享
 * - 自描述性：instructions 让 Extension 可以自带使用说明，注入到 Agent 的 system prompt 中
 *
 * 当前实现是简单的配置对象，未来可以扩展生命周期钩子（如 onActivate/onDeactivate）。
 *
 * 架构位置：SDK 层，是面向开发者的高级抽象。
 *
 * @example
 * ```typescript
 * const weatherExt = extension({
 *   name: 'weather',
 *   description: 'Weather information tools',
 *   instructions: 'Use weather tools to answer weather-related questions.',
 *   tools: [getWeather, getForecast],
 * });
 * ```
 */

import type { Tool } from '@agent-tea/core';
import type { Skill } from './skill.js';

export interface Extension {
    name: string;
    description?: string;
    /** 激活此扩展时注入到 system prompt 中的指令 */
    instructions?: string;
    /** 此扩展提供的工具 */
    tools?: Tool[];
    /** 此扩展提供的技能（预定义的 prompt + 工具组合） */
    skills?: Skill[];
}

/** 创建一个 Extension 配置。当前仅做透传，为后续添加校验和增强预留入口。 */
export function extension(config: Extension): Extension {
    return config;
}
