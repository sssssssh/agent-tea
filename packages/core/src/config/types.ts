/**
 * Agent 配置类型
 *
 * 将所有 Agent 行为参数集中在一个配置对象中，
 * 使 Agent 构造函数保持简洁，同时方便序列化和共享配置。
 *
 * 架构位置：Core 层的 Config 子模块，被 Agent 构造函数消费。
 */

import type { LLMProvider } from '../llm/provider.js';
import type { Tool } from '../tools/types.js';
import type { ApprovalPolicy } from '../approval/types.js';
import type { ContextManagerConfig } from '../context/types.js';
import type { ConversationStore, MemoryStore } from '../memory/types.js';

/**
 * 创建 Agent 的配置项。
 * 必填项只有 provider 和 model，其余均可选带默认值。
 */
export interface AgentConfig {
  /** LLM Provider 实例（负责与具体 LLM 服务通信） */
  provider: LLMProvider;
  /** 模型 ID（如 'gpt-4o'、'claude-sonnet-4-20250514'） */
  model: string;
  /** Agent 可用的工具列表 */
  tools?: Tool[];
  /** 系统提示词，定义 Agent 的角色和行为规范 */
  systemPrompt?: string;
  /**
   * Agent 循环最大迭代次数（默认 20）。
   * 这是一个安全阀，防止 LLM 陷入无限工具调用循环。
   * Sub-Agent 通常可以设置更小的值（如 10）。
   */
  maxIterations?: number;
  /** LLM 生成温度（0-2），越低越确定性 */
  temperature?: number;
  /** 单次 LLM 响应的最大 token 数 */
  maxTokens?: number;
  /** Agent 标识，多 Agent 场景下用于区分来源。默认自动生成 UUID */
  agentId?: string;
  /** Agent 策略，默认 'react' */
  strategy?: 'react' | 'plan-and-execute';
  /**
   * 是否允许 LLM 运行时切换到 Plan 模式。
   * 仅当 strategy 为 'react'（默认）时有效 —— 自动注入 enter_plan_mode 工具。
   * strategy 为 'plan-and-execute' 时始终从 Plan 阶段开始，无需此选项。
   */
  allowPlanMode?: boolean;
  /** Plan 文件存储目录，默认 '.agent-tea/plans' */
  planStoreDir?: string;

  // ---- 审批系统 ----

  /**
   * 工具调用审批策略。
   * 不设置时全部自动通过（等同于 mode: 'never'）。
   */
  approvalPolicy?: ApprovalPolicy;

  // ---- 上下文管理 ----

  /** 上下文窗口管理配置，不设置时不做裁剪 */
  contextManager?: ContextManagerConfig;

  // ---- 记忆持久化 ----

  /** 会话历史存储，不设置时不保存会话 */
  conversationStore?: ConversationStore;
  /** 跨会话记忆存储，不设置时无持久记忆 */
  memoryStore?: MemoryStore;
}
