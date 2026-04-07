# Skill/Agent 文件系统自动发现 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持从 `~/.agent-tea/skills/`、`~/.agent-tea/agents/`（全局）和 `.agent-tea/skills/`、`.agent-tea/agents/`（项目级）自动发现并加载 Skill 和 Agent 定义，格式兼容 Claude Code 的 `SKILL.md` 标准。

**Architecture:** 在 `packages/sdk` 中新增 `discovery` 模块。用 frontmatter 解析器读取 `SKILL.md` / `AGENT.md` 文件，扫描全局 + 项目两级目录，项目级同名覆盖全局。返回结构化结果供 Agent 消费。不改动 core 层。

**Tech Stack:** TypeScript, Vitest, `gray-matter`（frontmatter 解析）, Node.js `fs/promises` + `path` + `os`

---

## 文件结构

| 操作   | 路径                                               | 职责                                                                          |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Create | `packages/sdk/src/discovery/types.ts`              | 类型定义：DiscoveryConfig、SkillDefinition、AgentDefinition、DiscoveredAssets |
| Create | `packages/sdk/src/discovery/parser.ts`             | 解析 SKILL.md / AGENT.md frontmatter + body                                   |
| Create | `packages/sdk/src/discovery/parser.test.ts`        | parser 单元测试                                                               |
| Create | `packages/sdk/src/discovery/loader.ts`             | 目录扫描、文件加载、作用域合并                                                |
| Create | `packages/sdk/src/discovery/loader.test.ts`        | loader 单元测试                                                               |
| Create | `packages/sdk/src/discovery/tool-resolver.ts`      | 按名称解析内置工具                                                            |
| Create | `packages/sdk/src/discovery/tool-resolver.test.ts` | tool-resolver 单元测试                                                        |
| Create | `packages/sdk/src/discovery/discover.ts`           | `discover()` 主函数，组装完整流程                                             |
| Create | `packages/sdk/src/discovery/discover.test.ts`      | 集成测试                                                                      |
| Create | `packages/sdk/src/discovery/index.ts`              | 模块导出                                                                      |
| Modify | `packages/sdk/src/index.ts`                        | 导出 discover 及相关类型                                                      |
| Modify | `packages/sdk/package.json`                        | 添加 `gray-matter` 依赖                                                       |
| Create | `examples/16-discovery.ts`                         | 使用示例                                                                      |

---

### Task 1: 添加 gray-matter 依赖

**Files:**

- Modify: `packages/sdk/package.json`

- [ ] **Step 1: 安装 gray-matter**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm add gray-matter --filter @agent-tea/sdk
```

- [ ] **Step 2: 验证安装**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm ls gray-matter --filter @agent-tea/sdk
```

Expected: 显示 gray-matter 版本号

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/package.json pnpm-lock.yaml
git commit -m "chore(sdk): add gray-matter dependency for frontmatter parsing"
```

---

### Task 2: 类型定义

**Files:**

- Create: `packages/sdk/src/discovery/types.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
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
    /** 额外的工具名称 → Tool 映射，扩展内置工具解析范围 */
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
```

- [ ] **Step 2: 验证类型检查通过**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm typecheck --filter @agent-tea/sdk
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/discovery/types.ts
git commit -m "feat(sdk): add discovery module type definitions"
```

---

### Task 3: Frontmatter 解析器

**Files:**

- Create: `packages/sdk/src/discovery/parser.ts`
- Create: `packages/sdk/src/discovery/parser.test.ts`

- [ ] **Step 1: 编写 parser 的失败测试**

```typescript
// packages/sdk/src/discovery/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseSkillFile, parseAgentFile } from './parser.js';

describe('parseSkillFile', () => {
    it('parses valid SKILL.md content', () => {
        const content = `---
name: code-review
description: 代码审查技能
version: 1.0.0
trigger: /review
tools:
  - read_file
  - grep
---

# 代码审查

仔细分析代码，关注类型安全和错误处理。`;

        const result = parseSkillFile(content, '/path/to/skills/code-review/SKILL.md', 'global');

        expect(result.skill.name).toBe('code-review');
        expect(result.skill.description).toBe('代码审查技能');
        expect(result.skill.trigger).toBe('/review');
        expect(result.skill.instructions).toContain('仔细分析代码');
        expect(result.sourcePath).toBe('/path/to/skills/code-review/SKILL.md');
        expect(result.scope).toBe('global');
    });

    it('parses skill without optional fields', () => {
        const content = `---
name: translator
description: 翻译助手
---

将用户输入翻译为目标语言。`;

        const result = parseSkillFile(content, '/path/to/SKILL.md', 'project');

        expect(result.skill.name).toBe('translator');
        expect(result.skill.trigger).toBeUndefined();
        expect(result.skill.instructions).toContain('将用户输入翻译为目标语言');
    });

    it('throws on missing name', () => {
        const content = `---
description: 无名技能
---

内容`;

        expect(() => parseSkillFile(content, '/path', 'global')).toThrow('name');
    });

    it('throws on missing description', () => {
        const content = `---
name: no-desc
---

内容`;

        expect(() => parseSkillFile(content, '/path', 'global')).toThrow('description');
    });

    it('returns raw tool names in frontmatter (not resolved Tool objects)', () => {
        const content = `---
name: with-tools
description: 带工具的技能
tools:
  - read_file
  - grep
---

指令`;

        const result = parseSkillFile(content, '/path', 'global');
        // parser 只解析 frontmatter，不负责解析工具引用
        // skill.tools 在此阶段为 undefined（工具解析由 loader 负责）
        expect(result.skill.tools).toBeUndefined();
    });
});

describe('parseAgentFile', () => {
    it('parses valid AGENT.md content', () => {
        const content = `---
name: researcher
description: 技术研究员
model: gpt-4o-mini
maxIterations: 8
tools:
  - web_fetch
  - grep
---

你是技术研究员。使用工具查找信息。`;

        const result = parseAgentFile(content, '/path/to/agents/researcher/AGENT.md', 'global');

        expect(result.name).toBe('researcher');
        expect(result.description).toBe('技术研究员');
        expect(result.model).toBe('gpt-4o-mini');
        expect(result.maxIterations).toBe(8);
        expect(result.systemPrompt).toContain('你是技术研究员');
        expect(result.sourcePath).toBe('/path/to/agents/researcher/AGENT.md');
    });

    it('parses agent without optional fields', () => {
        const content = `---
name: coder
description: 编码员
---

你是编码专家。`;

        const result = parseAgentFile(content, '/path', 'project');

        expect(result.model).toBeUndefined();
        expect(result.maxIterations).toBeUndefined();
        expect(result.systemPrompt).toContain('你是编码专家');
        expect(result.scope).toBe('project');
    });

    it('throws on missing name', () => {
        const content = `---
description: 无名 Agent
---

内容`;

        expect(() => parseAgentFile(content, '/path', 'global')).toThrow('name');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/parser.test.ts
```

Expected: FAIL — `parseSkillFile` / `parseAgentFile` 未定义

- [ ] **Step 3: 实现 parser**

```typescript
// packages/sdk/src/discovery/parser.ts
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
 * 解析 SKILL.md 内容，返回 ParsedSkill。
 *
 * frontmatter 中的 tools 字段是工具名称字符串列表，不在此处解析为 Tool 对象。
 * skill.tools 保持 undefined，由 loader 层根据名称解析后注入。
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
        // tools 由 loader 层解析后注入，此处不设置
    };

    return {
        skill,
        sourcePath,
        scope,
        toolNames: fm.tools ?? [],
    };
}

/**
 * 解析 AGENT.md 内容，返回 ParsedAgent（tools 为空数组，由 loader 层填充）。
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/parser.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/discovery/parser.ts packages/sdk/src/discovery/parser.test.ts
git commit -m "feat(sdk): add SKILL.md and AGENT.md frontmatter parser"
```

---

### Task 4: 工具名称解析器

**Files:**

- Create: `packages/sdk/src/discovery/tool-resolver.ts`
- Create: `packages/sdk/src/discovery/tool-resolver.test.ts`

内置工具名称映射（`name` 属性值 → 导出变量名）：

| 工具 `name`      | 导出变量        |
| ---------------- | --------------- |
| `read_file`      | `readFile`      |
| `write_file`     | `writeFile`     |
| `list_directory` | `listDirectory` |
| `execute_shell`  | `executeShell`  |
| `grep`           | `grep`          |
| `web_fetch`      | `webFetch`      |

- [ ] **Step 1: 编写 tool-resolver 的失败测试**

```typescript
// packages/sdk/src/discovery/tool-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolResolver } from './tool-resolver.js';
import { readFile, grep, webFetch } from '@agent-tea/core';
import { tool } from '@agent-tea/core';

describe('ToolResolver', () => {
    it('resolves built-in tool names', () => {
        const resolver = new ToolResolver();

        expect(resolver.resolve('read_file')).toBe(readFile);
        expect(resolver.resolve('grep')).toBe(grep);
        expect(resolver.resolve('web_fetch')).toBe(webFetch);
    });

    it('resolves all 6 built-in tools', () => {
        const resolver = new ToolResolver();
        const names = [
            'read_file',
            'write_file',
            'list_directory',
            'execute_shell',
            'grep',
            'web_fetch',
        ];

        for (const name of names) {
            expect(resolver.resolve(name)).toBeDefined();
            expect(resolver.resolve(name)!.name).toBe(name);
        }
    });

    it('returns undefined for unknown tool name', () => {
        const resolver = new ToolResolver();
        expect(resolver.resolve('nonexistent')).toBeUndefined();
    });

    it('supports extra tools registration', () => {
        const customTool = tool(
            { name: 'custom_tool', description: 'A custom tool', parameters: z.object({}) },
            async () => 'ok',
        );

        const extras = new Map([['custom_tool', customTool]]);
        const resolver = new ToolResolver(extras);

        expect(resolver.resolve('custom_tool')).toBe(customTool);
        // 内置工具仍然可用
        expect(resolver.resolve('read_file')).toBe(readFile);
    });

    it('resolves a list of names, skipping unknown ones with warnings', () => {
        const resolver = new ToolResolver();
        const { tools, warnings } = resolver.resolveMany(['read_file', 'nonexistent', 'grep']);

        expect(tools).toHaveLength(2);
        expect(tools[0].name).toBe('read_file');
        expect(tools[1].name).toBe('grep');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('nonexistent');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/tool-resolver.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 tool-resolver**

```typescript
// packages/sdk/src/discovery/tool-resolver.ts
/**
 * 工具名称解析器
 *
 * 将 SKILL.md / AGENT.md 中声明的工具名称（如 'read_file'）
 * 解析为实际的 Tool 实例。优先查找内置工具，再查找用户注册的额外工具。
 */

import type { Tool } from '@agent-tea/core';
import { readFile, writeFile, listDirectory, executeShell, grep, webFetch } from '@agent-tea/core';

/** 内置工具名称 → Tool 实例 */
const BUILTIN_TOOLS: ReadonlyMap<string, Tool> = new Map([
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
            for (const [name, tool] of extraTools) {
                this.registry.set(name, tool);
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/tool-resolver.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/discovery/tool-resolver.ts packages/sdk/src/discovery/tool-resolver.test.ts
git commit -m "feat(sdk): add tool name resolver for discovery module"
```

---

### Task 5: 目录扫描与加载器

**Files:**

- Create: `packages/sdk/src/discovery/loader.ts`
- Create: `packages/sdk/src/discovery/loader.test.ts`

- [ ] **Step 1: 编写 loader 的失败测试**

```typescript
// packages/sdk/src/discovery/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSkillDirs, scanAgentDirs, mergeByName } from './loader.js';

describe('scanSkillDirs', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'agent-tea-test-'));
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('discovers SKILL.md files in subdirectories', async () => {
        // 创建 skills/code-review/SKILL.md
        const skillDir = join(tempDir, 'skills', 'code-review');
        await mkdir(skillDir, { recursive: true });
        await writeFile(
            join(skillDir, 'SKILL.md'),
            `---
name: code-review
description: 代码审查
---

审查指令`,
        );

        const results = await scanSkillDirs([{ dir: join(tempDir, 'skills'), scope: 'global' }]);

        expect(results).toHaveLength(1);
        expect(results[0].skill.name).toBe('code-review');
        expect(results[0].scope).toBe('global');
    });

    it('ignores directories without SKILL.md', async () => {
        const skillDir = join(tempDir, 'skills', 'empty-skill');
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'README.md'), '# Not a skill');

        const results = await scanSkillDirs([{ dir: join(tempDir, 'skills'), scope: 'global' }]);
        expect(results).toHaveLength(0);
    });

    it('skips non-existent directories gracefully', async () => {
        const results = await scanSkillDirs([
            { dir: join(tempDir, 'nonexistent'), scope: 'global' },
        ]);
        expect(results).toHaveLength(0);
    });

    it('discovers from multiple directories', async () => {
        const globalDir = join(tempDir, 'global', 'skills');
        const projectDir = join(tempDir, 'project', 'skills');

        await mkdir(join(globalDir, 'skill-a'), { recursive: true });
        await writeFile(
            join(globalDir, 'skill-a', 'SKILL.md'),
            `---\nname: skill-a\ndescription: A\n---\nA`,
        );

        await mkdir(join(projectDir, 'skill-b'), { recursive: true });
        await writeFile(
            join(projectDir, 'skill-b', 'SKILL.md'),
            `---\nname: skill-b\ndescription: B\n---\nB`,
        );

        const results = await scanSkillDirs([
            { dir: globalDir, scope: 'global' },
            { dir: projectDir, scope: 'project' },
        ]);

        expect(results).toHaveLength(2);
    });
});

describe('scanAgentDirs', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'agent-tea-test-'));
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('discovers AGENT.md files in subdirectories', async () => {
        const agentDir = join(tempDir, 'agents', 'researcher');
        await mkdir(agentDir, { recursive: true });
        await writeFile(
            join(agentDir, 'AGENT.md'),
            `---
name: researcher
description: 研究员
maxIterations: 8
---

你是研究员。`,
        );

        const results = await scanAgentDirs([{ dir: join(tempDir, 'agents'), scope: 'global' }]);

        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('researcher');
        expect(results[0].maxIterations).toBe(8);
    });
});

describe('mergeByName', () => {
    it('project scope overrides global scope for same name', () => {
        const items = [
            { name: 'review', scope: 'global' as const, value: 'global-version' },
            { name: 'review', scope: 'project' as const, value: 'project-version' },
            { name: 'translate', scope: 'global' as const, value: 'global-only' },
        ];

        const merged = mergeByName(
            items,
            (item) => item.name,
            (item) => item.scope,
        );

        expect(merged).toHaveLength(2);
        expect(merged.find((i) => i.name === 'review')!.value).toBe('project-version');
        expect(merged.find((i) => i.name === 'translate')!.value).toBe('global-only');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/loader.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 loader**

```typescript
// packages/sdk/src/discovery/loader.ts
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
                // SKILL.md 不存在或解析失败，跳过
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/loader.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/discovery/loader.ts packages/sdk/src/discovery/loader.test.ts
git commit -m "feat(sdk): add directory scanner and loader for skill/agent discovery"
```

---

### Task 6: discover() 主函数

**Files:**

- Create: `packages/sdk/src/discovery/discover.ts`
- Create: `packages/sdk/src/discovery/discover.test.ts`

- [ ] **Step 1: 编写 discover 的失败测试**

```typescript
// packages/sdk/src/discovery/discover.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile as fsWriteFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover } from './discover.js';
import type { LLMProvider, ChatSession } from '@agent-tea/core';

/** 创建一个最小 mock provider（discover 只用它构建 SubAgent，不实际调用 LLM） */
function mockProvider(): LLMProvider {
    return {
        createSession: () =>
            ({
                sendMessage: async function* () {},
            }) as unknown as ChatSession,
    };
}

describe('discover', () => {
    let tempDir: string;
    let globalDir: string;
    let projectDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'agent-tea-discover-'));
        globalDir = join(tempDir, 'global');
        projectDir = join(tempDir, 'project');
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('discovers skills and returns instructions', async () => {
        await mkdir(join(globalDir, 'skills', 'review'), { recursive: true });
        await fsWriteFile(
            join(globalDir, 'skills', 'review', 'SKILL.md'),
            `---\nname: review\ndescription: Code review\n---\n\nReview the code carefully.`,
        );

        const result = await discover({
            provider: mockProvider(),
            model: 'test-model',
            globalDir,
            projectDir,
        });

        expect(result.skills).toHaveLength(1);
        expect(result.skills[0].name).toBe('review');
        expect(result.instructions).toContain('Review the code carefully');
    });

    it('discovers agents and wraps as tools', async () => {
        await mkdir(join(globalDir, 'agents', 'researcher'), { recursive: true });
        await fsWriteFile(
            join(globalDir, 'agents', 'researcher', 'AGENT.md'),
            `---\nname: researcher\ndescription: Research agent\nmaxIterations: 5\n---\n\nYou are a researcher.`,
        );

        const result = await discover({
            provider: mockProvider(),
            model: 'test-model',
            globalDir,
            projectDir,
        });

        expect(result.agents).toHaveLength(1);
        expect(result.agents[0].name).toBe('researcher');
    });

    it('project skills override global skills with same name', async () => {
        // 全局 skill
        await mkdir(join(globalDir, 'skills', 'review'), { recursive: true });
        await fsWriteFile(
            join(globalDir, 'skills', 'review', 'SKILL.md'),
            `---\nname: review\ndescription: Global review\n---\n\nGlobal instructions.`,
        );

        // 项目级 skill（同名）
        await mkdir(join(projectDir, 'skills', 'review'), { recursive: true });
        await fsWriteFile(
            join(projectDir, 'skills', 'review', 'SKILL.md'),
            `---\nname: review\ndescription: Project review\n---\n\nProject instructions.`,
        );

        const result = await discover({
            provider: mockProvider(),
            model: 'test-model',
            globalDir,
            projectDir,
        });

        expect(result.skills).toHaveLength(1);
        expect(result.skills[0].description).toBe('Project review');
        expect(result.instructions).toContain('Project instructions');
        expect(result.instructions).not.toContain('Global instructions');
    });

    it('merges skill tools and agent tools into combined tools list', async () => {
        await mkdir(join(globalDir, 'skills', 's1'), { recursive: true });
        await fsWriteFile(
            join(globalDir, 'skills', 's1', 'SKILL.md'),
            `---\nname: s1\ndescription: S1\ntools:\n  - read_file\n---\n\nInstructions`,
        );

        await mkdir(join(globalDir, 'agents', 'a1'), { recursive: true });
        await fsWriteFile(
            join(globalDir, 'agents', 'a1', 'AGENT.md'),
            `---\nname: a1\ndescription: A1\n---\n\nSystem prompt`,
        );

        const result = await discover({
            provider: mockProvider(),
            model: 'test-model',
            globalDir,
            projectDir,
        });

        // tools = skill 引用的内置工具 + agent 包装的 Tool
        expect(result.tools.length).toBeGreaterThanOrEqual(2);
        expect(result.tools.some((t) => t.name === 'read_file')).toBe(true);
        expect(result.tools.some((t) => t.name === 'a1')).toBe(true);
    });

    it('returns empty result when no files exist', async () => {
        const result = await discover({
            provider: mockProvider(),
            model: 'test-model',
            globalDir,
            projectDir,
        });

        expect(result.skills).toEqual([]);
        expect(result.agents).toEqual([]);
        expect(result.tools).toEqual([]);
        expect(result.instructions).toBe('');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/discover.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 discover**

````typescript
// packages/sdk/src/discovery/discover.ts
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

        // 收集 skill 引用的工具（去重在最后统一处理）
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
````

- [ ] **Step 4: 运行测试确认通过**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm vitest run packages/sdk/src/discovery/discover.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/discovery/discover.ts packages/sdk/src/discovery/discover.test.ts
git commit -m "feat(sdk): add discover() main function for file-based skill/agent discovery"
```

---

### Task 7: 模块导出与集成

**Files:**

- Create: `packages/sdk/src/discovery/index.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: 创建 discovery 模块入口**

```typescript
// packages/sdk/src/discovery/index.ts
/**
 * Discovery 模块 —— 文件系统 Skill/Agent 自动发现
 */

export { discover } from './discover.js';
export { ToolResolver } from './tool-resolver.js';
export { parseSkillFile, parseAgentFile } from './parser.js';
export { scanSkillDirs, scanAgentDirs, mergeByName } from './loader.js';
export type {
    DiscoveryConfig,
    DiscoveredAssets,
    SkillFrontmatter,
    AgentFrontmatter,
    ParsedSkill,
    ParsedAgent,
} from './types.js';
```

- [ ] **Step 2: 在 SDK 主入口导出**

在 `packages/sdk/src/index.ts` 文件末尾追加：

```typescript
// ---- Discovery ----
export { discover, ToolResolver } from './discovery/index.js';
export type {
    DiscoveryConfig,
    DiscoveredAssets,
    ParsedSkill,
    ParsedAgent,
} from './discovery/index.js';
```

- [ ] **Step 3: 更新 tsup 入口（如需要）**

当前 `tsup.config.ts` 的 entry 是 `['src/index.ts']`，所有新代码通过 `index.ts` 重新导出即可，无需改动 tsup 配置。

- [ ] **Step 4: 验证构建和类型检查**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm build --filter @agent-tea/sdk && pnpm typecheck --filter @agent-tea/sdk
```

Expected: 构建和类型检查均无错误

- [ ] **Step 5: 运行全量测试**

```bash
cd /Users/ssh/code-ai-agent/agent-tea && pnpm test
```

Expected: 全部 PASS（包括新增的 discovery 测试）

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/discovery/index.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): export discovery module from SDK entry point"
```

---

### Task 8: 使用示例

**Files:**

- Create: `examples/16-discovery.ts`
- Modify: `package.json`（添加 example:16 脚本）

- [ ] **Step 1: 创建示例文件**

```typescript
// examples/16-discovery.ts
/**
 * 示例 16: Skill/Agent 自动发现
 *
 * 演示从文件系统自动加载 Skill 和 Agent 定义。
 *
 * 准备工作：
 * 1. 创建 ~/.agent-tea/skills/translator/SKILL.md（全局 Skill）
 * 2. 创建 .agent-tea/skills/code-review/SKILL.md（项目级 Skill）
 * 3. 创建 .agent-tea/agents/researcher/AGENT.md（项目级 Agent）
 *
 * 运行：pnpm example:16
 */

import { Agent, discover } from '@agent-tea/sdk';
import { OpenAIProvider } from '@agent-tea/provider-openai';

async function main() {
    const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
    const model = 'gpt-4o-mini';

    // 自动发现所有 Skill 和 Agent
    console.log('🔍 扫描 ~/.agent-tea/ 和 .agent-tea/ ...\n');
    const found = await discover({ provider, model });

    console.log(`发现 ${found.skills.length} 个 Skill:`);
    for (const s of found.skills) {
        console.log(`  - ${s.name}: ${s.description}`);
    }

    console.log(`\n发现 ${found.agents.length} 个 Agent:`);
    for (const a of found.agents) {
        console.log(`  - ${a.name}: ${a.description}`);
    }

    console.log(`\n合计 ${found.tools.length} 个可用工具\n`);

    if (found.tools.length === 0) {
        console.log('未发现任何 Skill 或 Agent。请先创建示例文件，参考本文件顶部注释。');
        return;
    }

    // 创建 Agent 并注入发现的能力
    const agent = new Agent({
        provider,
        model,
        tools: found.tools,
        systemPrompt: `你是一个多能力助手。\n\n${found.instructions}`,
    });

    const query = '帮我分析一下当前项目的代码结构';
    console.log(`用户: ${query}\n`);

    for await (const event of agent.run(query)) {
        if (event.type === 'message' && event.role === 'assistant') {
            process.stdout.write(event.content);
        }
        if (event.type === 'tool_request') {
            console.log(`\n[调用工具] ${event.toolName}`);
        }
    }
    console.log();
}

main().catch(console.error);
```

- [ ] **Step 2: 在 package.json 中添加运行脚本**

在 `package.json` 的 `scripts` 中添加：

```json
"example:16": "node --env-file=.env --import tsx examples/16-discovery.ts"
```

- [ ] **Step 3: Commit**

```bash
git add examples/16-discovery.ts package.json
git commit -m "feat: add discovery usage example (example 16)"
```

---

### Task 9: 更新 CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: 在 CLAUDE.md 中添加 Discovery 相关文档**

在"常用命令"部分添加 `pnpm example:16` 的说明。

在"核心概念"或适当位置添加 Discovery 模块说明：

```markdown
**自动发现**（`packages/sdk/src/discovery/`）：从文件系统加载 Skill 和 Agent 定义。扫描 `~/.agent-tea/`（全局）和 `.agent-tea/`（项目级）目录，项目级同名覆盖全局。Skill 用 `SKILL.md`（YAML frontmatter + markdown 指令），Agent 用 `AGENT.md`（frontmatter + systemPrompt）。`discover({ provider, model })` 返回 `{ skills, agents, tools, instructions }`，可直接合并到 AgentConfig。
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add discovery module documentation to CLAUDE.md"
```
