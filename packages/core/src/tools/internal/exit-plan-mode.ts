/**
 * exit_plan_mode —— 内置工具，提交计划等待审批
 *
 * LLM 在规划完成后调用，提交计划概要。
 * 实际的审批流程由 Agent 在 onBeforeToolCall 中拦截处理。
 */

import { z } from 'zod';
import { tool } from '../builder.js';

export const exitPlanModeTool = tool(
    {
        name: 'exit_plan_mode',
        description: '规划完成后调用，提交计划等待审批。',
        parameters: z.object({
            planSummary: z.string().describe('计划概要'),
        }),
        tags: ['internal'],
    },
    async ({ planSummary }) => {
        return `计划已提交审批。概要：${planSummary}`;
    },
);
