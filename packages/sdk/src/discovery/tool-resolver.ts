/**
 * 工具名称解析器
 *
 * 将 SKILL.md / AGENT.md 中声明的工具名称（如 'read_file'）
 * 解析为实际的 Tool 实例。优先查找内置工具，再查找用户注册的额外工具。
 */

import type { Tool } from '@t-agent/core';
import {
  readFile,
  writeFile,
  listDirectory,
  executeShell,
  grep,
  webFetch,
} from '@t-agent/core';

/** 内置工具名称 → Tool 实例 */
const BUILTIN_TOOLS: ReadonlyMap<string, Tool> = new Map<string, Tool>([
  ['read_file', readFile],
  ['write_file', writeFile],
  ['list_directory', listDirectory],
  ['execute_shell', executeShell],
  ['grep', grep],
  ['web_fetch', webFetch],
]);

export class ToolResolver {
  private readonly registry: Map<string, Tool>;

  constructor(extraTools?: Map<string, Tool>) {
    this.registry = new Map(BUILTIN_TOOLS);
    if (extraTools) {
      for (const [name, t] of extraTools) {
        this.registry.set(name, t);
      }
    }
  }

  /** 按名称解析单个工具，未找到返回 undefined */
  resolve(name: string): Tool | undefined {
    return this.registry.get(name);
  }

  /** 批量解析工具名称列表，返回解析成功的工具和警告信息 */
  resolveMany(names: string[]): { tools: Tool[]; warnings: string[] } {
    const tools: Tool[] = [];
    const warnings: string[] = [];

    for (const name of names) {
      const t = this.resolve(name);
      if (t) {
        tools.push(t);
      } else {
        warnings.push(`未知工具名称 "${name}"，已跳过`);
      }
    }

    return { tools, warnings };
  }
}
