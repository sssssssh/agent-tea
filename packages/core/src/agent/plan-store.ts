/**
 * PlanStore —— 计划文件存储
 *
 * 将 Plan 对象序列化为 JSON 文件，支持读取和步骤状态更新。
 * 计划存为文件的原因：方便用户审阅、存档、出问题时回查。
 *
 * 架构位置：Core 层 Agent 子模块，被 PlanAndExecuteAgent 使用。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Plan, PlanStep } from './types.js';

export class PlanStore {
    constructor(private readonly baseDir: string = '.agent-tea/plans') {}

    async save(plan: Plan, sessionId: string): Promise<string> {
        await fs.mkdir(this.baseDir, { recursive: true });
        const fileName = `${sessionId}-${plan.id}.json`;
        const filePath = path.join(this.baseDir, fileName);
        plan.filePath = filePath;
        await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');
        return filePath;
    }

    async load(filePath: string): Promise<Plan> {
        const content = await fs.readFile(filePath, 'utf-8');
        const plan = JSON.parse(content) as Plan;
        plan.createdAt = new Date(plan.createdAt);
        return plan;
    }

    async updateStep(
        filePath: string,
        stepIndex: number,
        status: PlanStep['status'],
    ): Promise<void> {
        const plan = await this.load(filePath);
        if (stepIndex < 0 || stepIndex >= plan.steps.length) {
            throw new Error(`Step index ${stepIndex} out of range (0-${plan.steps.length - 1})`);
        }
        plan.steps[stepIndex].status = status;
        await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');
    }
}
