/**
 * discover() —— Skill/Agent 文件系统自动发现主函数
 *
 * 扫描全局（~/.agent-tea/）和项目级（.agent-tea/）目录，
 * 加载 SKILL.md 和 AGENT.md，解析工具引用，
 * 将 Agent 定义包装为 SubAgent Tool，返回可直接消费的结果。
 *
 * @example
 * ```typescript
 * const found = await discover({ provider, model });
 * const agent = new Agent({
 *   provider, model,
 *   tools: [...myTools, ...found.tools],
 *   systemPrompt: `${basePrompt}\n${found.instructions}`,
 * });
 * ```
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { subAgent } from '../sub-agent.js';
import { ToolResolver } from './tool-resolver.js';
import { scanSkillDirs, scanAgentDirs, mergeByName } from './loader.js';
import type { DiscoveryConfig, DiscoveredAssets } from './types.js';
import type { Skill } from '../skill.js';
import type { Tool } from '@agent-tea/core';

/**
 * 从文件系统自动发现 Skill 和 Agent 定义。
 *
 * 扫描顺序：先全局再项目，项目级同名覆盖全局。
 * Agent 定义中未指定 provider/model 的，使用配置中提供的默认值。
 */
export async function discover(config: DiscoveryConfig): Promise<DiscoveredAssets> {
    const globalBase = config.globalDir ?? join(homedir(), '.agent-tea');
    const projectBase = config.projectDir ?? join(process.cwd(), '.agent-tea');

    const resolver = new ToolResolver(config.extraTools);

    // ---- 扫描 Skills ----
    const rawSkills = await scanSkillDirs([
        { dir: join(globalBase, 'skills'), scope: 'global' },
        { dir: join(projectBase, 'skills'), scope: 'project' },
    ]);

    const mergedSkills = mergeByName(
        rawSkills,
        (s) => s.skill.name,
        (s) => s.scope,
    );

    // 解析工具引用，注入到 skill.tools
    const skills: Skill[] = [];
    const skillTools: Tool[] = [];

    for (const parsed of mergedSkills) {
        const { tools, warnings } = resolver.resolveMany(parsed.toolNames);
        for (const w of warnings) {
            console.warn(`[discovery] skill "${parsed.skill.name}": ${w}`);
        }

        const skill: Skill = {
            ...parsed.skill,
            tools: tools.length > 0 ? tools : undefined,
        };
        skills.push(skill);

        for (const t of tools) {
            skillTools.push(t);
        }
    }

    // ---- 扫描 Agents ----
    const rawAgents = await scanAgentDirs([
        { dir: join(globalBase, 'agents'), scope: 'global' },
        { dir: join(projectBase, 'agents'), scope: 'project' },
    ]);

    const mergedAgents = mergeByName(
        rawAgents,
        (a) => a.name,
        (a) => a.scope,
    );

    // 将 Agent 定义包装为 SubAgent Tool
    const agentTools: Tool[] = [];
    for (const parsed of mergedAgents) {
        const { tools, warnings } = resolver.resolveMany(parsed.toolNames);
        for (const w of warnings) {
            console.warn(`[discovery] agent "${parsed.name}": ${w}`);
        }

        const agentTool = subAgent({
            name: parsed.name,
            description: parsed.description,
            provider: config.provider,
            model: parsed.model ?? config.model,
            tools: tools.length > 0 ? tools : undefined,
            systemPrompt: parsed.systemPrompt,
            maxIterations: parsed.maxIterations,
        });

        agentTools.push(agentTool);
    }

    // ---- 组装结果 ----

    // 合并去重：skill 工具 + agent 工具
    const toolMap = new Map<string, Tool>();
    for (const t of [...skillTools, ...agentTools]) {
        toolMap.set(t.name, t);
    }

    // 拼接 skill instructions
    const instructions = skills
        .map((s) => {
            const header = `## ${s.name}`;
            const desc = s.description;
            return `${header}\n${desc}\n\n${s.instructions}`;
        })
        .join('\n\n---\n\n');

    return {
        skills,
        agents: agentTools,
        tools: Array.from(toolMap.values()),
        instructions,
    };
}
