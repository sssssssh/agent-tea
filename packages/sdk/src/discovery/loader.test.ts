// packages/sdk/src/discovery/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSkillDirs, scanAgentDirs, mergeByName } from './loader.js';

describe('scanSkillDirs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 't-agent-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers SKILL.md files in subdirectories', async () => {
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
    await writeFile(join(globalDir, 'skill-a', 'SKILL.md'), `---\nname: skill-a\ndescription: A\n---\nA`);

    await mkdir(join(projectDir, 'skill-b'), { recursive: true });
    await writeFile(join(projectDir, 'skill-b', 'SKILL.md'), `---\nname: skill-b\ndescription: B\n---\nB`);

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
    tempDir = await mkdtemp(join(tmpdir(), 't-agent-test-'));
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

    const merged = mergeByName(items, (item) => item.name, (item) => item.scope);

    expect(merged).toHaveLength(2);
    expect(merged.find((i) => i.name === 'review')!.value).toBe('project-version');
    expect(merged.find((i) => i.name === 'translate')!.value).toBe('global-only');
  });
});
