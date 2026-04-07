/**
 * 目录扫描与加载器
 *
 * 扫描指定目录下的 skill/agent 子目录，读取 SKILL.md / AGENT.md，
 * 交给 parser 解析。支持多目录扫描和按名称合并（project 覆盖 global）。
 */

import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkillFile, parseAgentFile } from './parser.js';
import type { ParsedSkill, ParsedAgent } from './types.js';

interface ScanSource {
    dir: string;
    scope: 'global' | 'project';
}

/** 检查目录是否存在 */
async function dirExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * 扫描多个 skills 目录，返回所有解析成功的 ParsedSkill。
 * 每个 skills 目录下的子目录被视为一个 skill，需包含 SKILL.md。
 * 加载失败的文件会打印警告并跳过，不影响其他文件。
 */
export async function scanSkillDirs(
    sources: ScanSource[],
): Promise<(ParsedSkill & { toolNames: string[] })[]> {
    const results: (ParsedSkill & { toolNames: string[] })[] = [];

    for (const { dir, scope } of sources) {
        if (!(await dirExists(dir))) continue;

        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillMdPath = join(dir, entry.name, 'SKILL.md');
            try {
                const raw = await readFile(skillMdPath, 'utf-8');
                const parsed = parseSkillFile(raw, skillMdPath, scope);
                results.push(parsed);
            } catch (err) {
                // ENOENT 表示该子目录没有 SKILL.md，静默跳过
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.warn(
                        `[discovery] 加载 skill 失败: ${skillMdPath}`,
                        (err as Error).message,
                    );
                }
            }
        }
    }

    return results;
}

/**
 * 扫描多个 agents 目录，返回所有解析成功的 Agent 定义。
 */
export async function scanAgentDirs(
    sources: ScanSource[],
): Promise<(Omit<ParsedAgent, 'tools'> & { toolNames: string[] })[]> {
    const results: (Omit<ParsedAgent, 'tools'> & { toolNames: string[] })[] = [];

    for (const { dir, scope } of sources) {
        if (!(await dirExists(dir))) continue;

        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const agentMdPath = join(dir, entry.name, 'AGENT.md');
            try {
                const raw = await readFile(agentMdPath, 'utf-8');
                const parsed = parseAgentFile(raw, agentMdPath, scope);
                results.push(parsed);
            } catch (err) {
                // ENOENT 表示该子目录没有 AGENT.md，静默跳过
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.warn(
                        `[discovery] 加载 agent 失败: ${agentMdPath}`,
                        (err as Error).message,
                    );
                }
            }
        }
    }

    return results;
}

/**
 * 按名称合并列表，project 作用域的条目覆盖 global 同名条目。
 */
export function mergeByName<T>(
    items: T[],
    getName: (item: T) => string,
    getScope: (item: T) => 'global' | 'project',
): T[] {
    const map = new Map<string, T>();

    for (const item of items) {
        const name = getName(item);
        const existing = map.get(name);
        if (!existing || getScope(item) === 'project') {
            map.set(name, item);
        }
    }

    return Array.from(map.values());
}
