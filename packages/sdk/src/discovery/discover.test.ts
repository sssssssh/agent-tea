// packages/sdk/src/discovery/discover.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('project agents override global agents with same name', async () => {
    await mkdir(join(globalDir, 'agents', 'helper'), { recursive: true });
    await fsWriteFile(
      join(globalDir, 'agents', 'helper', 'AGENT.md'),
      `---\nname: helper\ndescription: Global helper\n---\n\nGlobal prompt.`,
    );

    await mkdir(join(projectDir, 'agents', 'helper'), { recursive: true });
    await fsWriteFile(
      join(projectDir, 'agents', 'helper', 'AGENT.md'),
      `---\nname: helper\ndescription: Project helper\n---\n\nProject prompt.`,
    );

    const result = await discover({
      provider: mockProvider(),
      model: 'test-model',
      globalDir,
      projectDir,
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('helper');
    expect(result.agents[0].description).toBe('Project helper');
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
