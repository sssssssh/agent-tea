/**
 * 基于文件系统的会话存储实现
 *
 * 将每个会话保存为独立的 JSON 文件，方便人工查看和调试。
 *
 * 存储路径：{baseDir}/{sessionId}.json
 * 文件内容：{ messages, metadata }
 *
 * 设计要点：
 * - JSON 格式，人类可读
 * - 每个会话一个文件，避免文件过大
 * - 自动创建目录
 *
 * 架构位置：Core 层 Memory 子模块，ConversationStore 的默认实现。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Message } from '../llm/types.js';
import type {
  ConversationStore,
  ConversationMetadata,
} from './types.js';

interface StoredConversation {
  sessionId: string;
  messages: Message[];
  metadata: ConversationMetadata;
}

export class FileConversationStore implements ConversationStore {
  constructor(
    private readonly baseDir: string = '.agent-tea/conversations',
  ) {}

  async save(
    sessionId: string,
    messages: Message[],
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });

    const filePath = this.getFilePath(sessionId);
    const existing = await this.load(sessionId);

    const stored: StoredConversation = {
      sessionId,
      messages,
      metadata: {
        createdAt: existing?.metadata.createdAt ?? new Date(),
        updatedAt: new Date(),
        ...metadata,
      },
    };

    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), 'utf-8');
  }

  async load(
    sessionId: string,
  ): Promise<{
    messages: Message[];
    metadata: ConversationMetadata;
  } | null> {
    const filePath = this.getFilePath(sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stored = JSON.parse(content) as StoredConversation;

      // 恢复 Date 对象
      stored.metadata.createdAt = new Date(stored.metadata.createdAt);
      stored.metadata.updatedAt = new Date(stored.metadata.updatedAt);

      return {
        messages: stored.messages,
        metadata: stored.metadata,
      };
    } catch {
      return null;
    }
  }

  async list(): Promise<
    { sessionId: string; metadata: ConversationMetadata }[]
  > {
    try {
      const files = await fs.readdir(this.baseDir);
      const results: {
        sessionId: string;
        metadata: ConversationMetadata;
      }[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const sessionId = file.replace('.json', '');
        const data = await this.load(sessionId);
        if (data) {
          results.push({ sessionId, metadata: data.metadata });
        }
      }

      // 按更新时间降序排列
      results.sort(
        (a, b) =>
          b.metadata.updatedAt.getTime() - a.metadata.updatedAt.getTime(),
      );

      return results;
    } catch {
      return [];
    }
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    try {
      await fs.unlink(filePath);
    } catch {
      // 文件不存在也不报错
    }
  }

  private getFilePath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.json`);
  }
}
