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
    expect(result.toolNames).toEqual([]);
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

  it('returns raw tool names (not resolved Tool objects)', () => {
    const content = `---
name: with-tools
description: 带工具的技能
tools:
  - read_file
  - grep
---

指令`;

    const result = parseSkillFile(content, '/path', 'global');
    // parser 只解析 frontmatter，工具解析由 loader 负责
    expect(result.skill.tools).toBeUndefined();
    expect(result.toolNames).toEqual(['read_file', 'grep']);
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
    expect(result.toolNames).toEqual(['web_fetch', 'grep']);
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
    expect(result.toolNames).toEqual([]);
  });

  it('throws on missing description', () => {
    const content = `---
name: no-desc-agent
---

内容`;

    expect(() => parseAgentFile(content, '/path', 'global')).toThrow('description');
  });

  it('throws on missing name', () => {
    const content = `---
description: 无名 Agent
---

内容`;

    expect(() => parseAgentFile(content, '/path', 'global')).toThrow('name');
  });
});
