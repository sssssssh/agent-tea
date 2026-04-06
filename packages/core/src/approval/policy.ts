/**
 * 审批策略评估器
 *
 * 判断某个工具调用是否需要用户审批。
 * 逻辑非常简单——复杂度应该在策略配置层面，而不是在评估逻辑里。
 *
 * 架构位置：Core 层的 Approval 子模块，被 BaseAgent 调用。
 */

import type { Tool } from '../tools/types.js';
import type { ApprovalPolicy } from './types.js';

/**
 * 判断给定工具是否需要审批。
 *
 * 三种模式的判断逻辑：
 * - 'never':  永远返回 false
 * - 'always': 永远返回 true
 * - 'tagged': 检查工具的 tags 是否包含任意一个 requireApprovalTags
 */
export function requiresApproval(
  tool: Tool,
  policy: ApprovalPolicy | undefined,
): boolean {
  if (!policy || policy.mode === 'never') {
    return false;
  }

  if (policy.mode === 'always') {
    return true;
  }

  // mode === 'tagged'
  const requiredTags = policy.requireApprovalTags ?? [];
  if (requiredTags.length === 0) {
    return false;
  }

  const toolTags = tool.tags ?? [];
  return requiredTags.some((tag) => toolTags.includes(tag));
}
