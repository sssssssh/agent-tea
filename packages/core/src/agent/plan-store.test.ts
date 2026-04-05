import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlanStore } from './plan-store.js';
import type { Plan } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('PlanStore', () => {
  let tmpDir: string;
  let store: PlanStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-store-test-'));
    store = new PlanStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makePlan(overrides?: Partial<Plan>): Plan {
    return {
      id: 'plan-1',
      filePath: '',
      steps: [
        { index: 0, description: 'Step 1: do something', status: 'pending' },
        { index: 1, description: 'Step 2: do another thing', status: 'pending' },
      ],
      rawContent: '1. do something\n2. do another thing',
      createdAt: new Date('2026-04-05'),
      ...overrides,
    };
  }

  it('saves and loads a plan', async () => {
    const plan = makePlan();
    const filePath = await store.save(plan, 'session-1');

    expect(filePath).toContain('session-1');
    expect(filePath).toContain(tmpDir);

    const loaded = await store.load(filePath);
    expect(loaded.id).toBe('plan-1');
    expect(loaded.steps).toHaveLength(2);
    expect(loaded.steps[0].description).toBe('Step 1: do something');
  });

  it('updates step status', async () => {
    const plan = makePlan();
    const filePath = await store.save(plan, 'session-2');

    await store.updateStep(filePath, 0, 'completed');

    const loaded = await store.load(filePath);
    expect(loaded.steps[0].status).toBe('completed');
    expect(loaded.steps[1].status).toBe('pending');
  });

  it('creates directory if not exists', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'dir');
    const nestedStore = new PlanStore(nestedDir);
    const plan = makePlan();

    const filePath = await nestedStore.save(plan, 'session-3');
    const loaded = await nestedStore.load(filePath);
    expect(loaded.id).toBe('plan-1');
  });
});
