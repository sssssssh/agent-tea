/**
 * Discovery 模块类型定义
 *
 * 定义文件系统自动发现 Skill/Agent 的配置和结果类型。
 */

import type { LLMProvider, Tool } from '@agent-tea/core';
import type { Skill } from '../skill.js';

// ---- SKILL.md frontmatter 字段 ----

/** SKILL.md 文件的 frontmatter 结构 */
export interface SkillFrontmatter {
    /** 技能唯一名称（kebab-case） */
    name: string;
    /** 技能描述，描述何时激活 */
    description: string;
    /** 语义版本号 */
    version?: string;
    /** 触发命令（如 '/review'） */
    trigger?: string;
    /** 引用的内置工具名称列表（如 ['read_file', 'grep']） */
    tools?: string[];
}

// ---- AGENT.md frontmatter 字段 ----

/** AGENT.md 文件的 frontmatter 结构 */
export interface AgentFrontmatter {
    /** Agent 唯一名称（kebab-case） */
    name: string;
    /** Agent 能力描述 */
    description: string;
    /** 模型 ID，不填则继承父 Agent */
    model?: string;
    /** 最大迭代次数，默认 10 */
    maxIterations?: number;
    /** 引用的内置工具名称列表 */
    tools?: string[];
}

// ---- 解析结果 ----

/** 从 SKILL.md 解析出的完整 Skill 定义 */
export interface ParsedSkill {
    /** 来源：从 frontmatter 和 body 解析 */
    skill: Skill;
    /** 原始文件路径 */
    sourcePath: string;
    /** 作用域：全局或项目级 */
    scope: 'global' | 'project';
}

/** 从 AGENT.md 解析出的 Agent 定义（不含 provider，运行时注入） */
export interface ParsedAgent {
    /** frontmatter 字段 */
    name: string;
    description: string;
    model?: string;
    maxIterations?: number;
    /** 已解析的工具实例（从名称解析为 Tool 对象） */
    tools: Tool[];
    /** body 作为 systemPrompt */
    systemPrompt: string;
    /** 原始文件路径 */
    sourcePath: string;
    /** 作用域 */
    scope: 'global' | 'project';
}

// ---- 发现配置 ----

/** discover() 函数的配置 */
export interface DiscoveryConfig {
    /** 项目根目录，默认 process.cwd() */
    projectDir?: string;
    /** 全局配置目录，默认 ~/.agent-tea */
    globalDir?: string;
    /** LLM Provider，用于创建 SubAgent */
    provider: LLMProvider;
    /** 默认模型，SubAgent 未指定 model 时使用 */
    model: string;
    /** 额外的工具名称 -> Tool 映射，扩展内置工具解析范围 */
    extraTools?: Map<string, Tool>;
}

// ---- 发现结果 ----

/** discover() 的返回值 */
export interface DiscoveredAssets {
    /** 所有已发现的 Skill 定义 */
    skills: Skill[];
    /** SubAgent 包装为 Tool，可直接注册到父 Agent */
    agents: Tool[];
    /** skills 的工具 + agents 合并后的完整工具列表 */
    tools: Tool[];
    /** 所有 skill instructions 拼接，用于注入 systemPrompt */
    instructions: string;
}
