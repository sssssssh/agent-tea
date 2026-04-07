/**
 * enter_plan_mode —— 内置工具，允许 LLM 在运行时切换到 Plan 模式
 *
 * 当 ReActAgent 的 allowPlanMode=true 时自动注入。
 * LLM 调用此工具后，Agent 内部将控制权移交给 Plan 阶段。
 *
 * 实际的状态切换由 Agent 在 onBeforeToolCall 中拦截处理，
 * 此工具的 execute 只是返回确认消息。
 */

import { z } from 'zod';
import { tool } from '../builder.js';

export const enterPlanModeTool = tool(
    {
        name: 'enter_plan_mode',
        description:
            '当任务复杂、需要多步骤规划时调用。进入规划模式后只能使用只读工具来探索和制定计划。',
        parameters: z.object({
            reason: z.string().describe('为什么需要进入规划模式'),
        }),
        tags: ['readonly', 'internal'],
    },
    async ({ reason }) => {
        return `已进入规划模式。原因：${reason}\n请开始探索代码并制定执行计划。`;
    },
);
