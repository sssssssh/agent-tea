/**
 * SKILL.md / AGENT.md 文件解析器
 *
 * 使用 gray-matter 解析 YAML frontmatter + markdown body。
 * 职责仅限解析和校验必填字段，不负责工具名称解析（由 loader 层处理）。
 */

import matter from 'gray-matter';
import type { Skill } from '../skill.js';
import type { SkillFrontmatter, AgentFrontmatter, ParsedSkill, ParsedAgent } from './types.js';

/**
 * 解析 SKILL.md 内容，返回 ParsedSkill + toolNames。
 * skill.tools 保持 undefined，工具解析由 loader 层负责。
 */
export function parseSkillFile(
    raw: string,
    sourcePath: string,
    scope: 'global' | 'project',
): ParsedSkill & { toolNames: string[] } {
    const { data, content } = matter(raw);
    const fm = data as Partial<SkillFrontmatter>;

    if (!fm.name) {
        throw new Error(`SKILL.md 缺少必填字段 "name": ${sourcePath}`);
    }
    if (!fm.description) {
        throw new Error(`SKILL.md 缺少必填字段 "description": ${sourcePath}`);
    }

    const skill: Skill = {
        name: fm.name,
        description: fm.description,
        instructions: content.trim(),
        trigger: fm.trigger,
    };

    return {
        skill,
        sourcePath,
        scope,
        toolNames: fm.tools ?? [],
    };
}

/**
 * 解析 AGENT.md 内容，返回 Agent 定义（tools 为空，由 loader 层填充）。
 */
export function parseAgentFile(
    raw: string,
    sourcePath: string,
    scope: 'global' | 'project',
): Omit<ParsedAgent, 'tools'> & { toolNames: string[] } {
    const { data, content } = matter(raw);
    const fm = data as Partial<AgentFrontmatter>;

    if (!fm.name) {
        throw new Error(`AGENT.md 缺少必填字段 "name": ${sourcePath}`);
    }
    if (!fm.description) {
        throw new Error(`AGENT.md 缺少必填字段 "description": ${sourcePath}`);
    }

    return {
        name: fm.name,
        description: fm.description,
        model: fm.model,
        maxIterations: fm.maxIterations,
        systemPrompt: content.trim(),
        sourcePath,
        scope,
        toolNames: fm.tools ?? [],
    };
}
