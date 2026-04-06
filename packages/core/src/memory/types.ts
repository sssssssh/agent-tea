/**
 * 记忆持久化类型定义
 *
 * 两个独立的存储接口，解决不同层面的持久化需求：
 *
 * ConversationStore —— 会话级持久化
 *   保存完整对话历史，用于：断点续传、审计回查、会话分析
 *
 * MemoryStore —— 知识级持久化
 *   保存跨会话的结构化知识，用于：用户偏好、项目上下文、学习积累
 *
 * 两者的区别类比：
 * - ConversationStore ≈ 聊天记录（每次对话完整保存）
 * - MemoryStore ≈ 笔记本（从对话中提取的关键信息）
 *
 * 架构位置：Core 层的 Memory 子模块。接口在 core 定义，实现可在 core 或 SDK 层。
 */

import type { Message } from '../llm/types.js';

// ============================================================
// 会话存储
// ============================================================

/** 会话记录的元数据 */
export interface ConversationMetadata {
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 使用的模型 */
  model?: string;
  /** 自定义元数据 */
  [key: string]: unknown;
}

/**
 * 会话存储接口。
 *
 * 持久化完整的对话历史，支持保存、加载、列举会话。
 * 实现者可以选择不同的存储后端（文件、数据库、云存储）。
 */
export interface ConversationStore {
  /** 保存会话消息 */
  save(
    sessionId: string,
    messages: Message[],
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /** 加载会话消息，不存在返回 null */
  load(
    sessionId: string,
  ): Promise<{
    messages: Message[];
    metadata: ConversationMetadata;
  } | null>;

  /** 列举所有已保存的会话 */
  list(): Promise<
    { sessionId: string; metadata: ConversationMetadata }[]
  >;

  /** 删除一个会话 */
  delete(sessionId: string): Promise<void>;
}

// ============================================================
// 知识记忆存储
// ============================================================

/** 单条记忆条目 */
export interface MemoryEntry {
  /** 唯一键，用于查找和更新 */
  key: string;
  /** 记忆内容 */
  content: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 分类标签 */
  tags?: string[];
}

/**
 * 知识记忆存储接口。
 *
 * 存储跨会话的持久化知识片段。Agent 可以在会话开始时加载相关记忆，
 * 在会话中提取新知识并保存。
 *
 * 设计为简单的 key-value 存储 + 标签过滤，不引入向量搜索的复杂度。
 * 需要语义搜索时，实现者可以在 search() 方法中集成向量数据库。
 */
export interface MemoryStore {
  /** 添加或更新一条记忆 */
  set(
    key: string,
    content: string,
    tags?: string[],
  ): Promise<void>;

  /** 获取一条记忆，不存在返回 null */
  get(key: string): Promise<MemoryEntry | null>;

  /** 按标签搜索记忆，不传标签返回全部 */
  search(tags?: string[]): Promise<MemoryEntry[]>;

  /** 删除一条记忆 */
  delete(key: string): Promise<void>;

  /** 列举所有记忆 */
  list(): Promise<MemoryEntry[]>;
}
