/**
 * Skill —— 预定义的"提示词 + 工具"组合
 *
 * Skill 与 Extension 的区别：
 * - Extension 是能力容器（可以包含多个 Skill）
 * - Skill 是面向特定任务的配方（包含专属指令和工具）
 *
 * 设计意图：
 * - 将常用的 Agent 行为模式封装为可激活的技能
 * - 通过 trigger 支持用户用快捷命令激活（如 '/review'）
 * - instructions 在激活时注入 system prompt，改变 Agent 的行为模式
 *
 * 架构位置：SDK 层，是面向开发者的高级抽象。
 *
 * @example
 * ```typescript
 * const codeReviewSkill = skill({
 *   name: 'code-review',
 *   description: 'Review code for bugs and improvements',
 *   instructions: 'Analyze the code carefully. Focus on bugs, security issues, and performance.',
 *   trigger: '/review',
 *   tools: [readFile, grep],
 * });
 * ```
 */

import type { Tool } from '@agent-tea/core';

export interface Skill {
  /** 技能唯一名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 激活时注入 system prompt 的指令，定义 Agent 在此技能下的行为 */
  instructions: string;
  /** 此技能专属的工具（仅在技能激活时可用） */
  tools?: Tool[];
  /** 触发命令（如 '/review'），用户输入此命令可激活技能 */
  trigger?: string;
}

/** 创建一个 Skill 配置。当前仅做透传，为后续添加校验和增强预留入口。 */
export function skill(config: Skill): Skill {
  return config;
}
