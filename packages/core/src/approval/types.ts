/**
 * 审批系统类型定义
 *
 * 审批系统解决的核心问题：Agent 在执行不可逆操作（发消息、写数据、调用外部 API）前，
 * 需要暂停并等待用户确认。
 *
 * 工作流程：
 * 1. Agent 调用工具前，根据 ApprovalPolicy 判断是否需要审批
 * 2. 需要审批时，yield ApprovalRequestEvent 暂停执行
 * 3. 消费者（UI/CLI）展示审批请求，用户做出决定
 * 4. 消费者调用 agent.resolveApproval(id, decision) 恢复执行
 *
 * 设计要点：
 * - 复用已有的 Tool.tags 机制标记哪些工具需要审批（不新增字段）
 * - ApprovalPolicy 支持三种模式，覆盖从"全自动"到"全人工"的谱系
 * - ApprovalDecision 支持修改参数，允许用户在审批时调整工具入参
 *
 * 架构位置：Core 层的 Approval 子模块，被 BaseAgent 的 executeToolCalls 消费。
 */

/**
 * 审批策略配置。
 *
 * 决定哪些工具调用需要人工确认，是安全性与效率的权衡点。
 * 框架使用者根据场景选择合适的模式：
 * - 开发/测试环境用 'never'
 * - 生产环境用 'tagged' + 对高危操作打标签
 * - 高安全场景用 'always'
 */
export interface ApprovalPolicy {
  /**
   * 审批模式：
   * - 'always': 所有工具调用都需要审批（最安全）
   * - 'tagged': 只有带指定标签的工具需要审批（推荐默认）
   * - 'never':  全部自动通过（测试/信任环境）
   */
  mode: 'always' | 'tagged' | 'never';

  /**
   * 当 mode='tagged' 时，带有这些标签的工具需要审批。
   * 例如 ['write', 'irreversible', 'external']
   * 默认为空数组（无工具需要审批）
   */
  requireApprovalTags?: string[];
}

/**
 * 用户的审批决定。
 *
 * 不只是简单的 yes/no，还支持：
 * - 附带拒绝原因（反馈给 LLM，帮助其调整策略）
 * - 修改参数（参考 Gemini CLI 的"确认时可编辑"设计）
 */
export interface ApprovalDecision {
  /** 是否批准执行 */
  approved: boolean;
  /** 拒绝原因，会作为工具错误返回给 LLM */
  reason?: string;
  /** 修改后的参数（批准时可选），允许用户在审批时微调入参 */
  modifiedArgs?: Record<string, unknown>;
}
