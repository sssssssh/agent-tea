/**
 * 基于文件系统的知识记忆存储实现
 *
 * 每条记忆保存为独立的 JSON 文件，以 key 为文件名。
 * 同时维护一个索引文件（index.json）加速列举和搜索操作。
 *
 * 存储路径：
 *   {baseDir}/entries/{key}.json   ← 单条记忆
 *   {baseDir}/index.json           ← 索引（key → tags 映射）
 *
 * 架构位置：Core 层 Memory 子模块，MemoryStore 的默认实现。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MemoryStore, MemoryEntry } from './types.js';

interface StoredEntry {
  key: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

interface MemoryIndex {
  entries: Record<string, { tags?: string[]; updatedAt: string }>;
}

export class FileMemoryStore implements MemoryStore {
  private readonly entriesDir: string;
  private readonly indexPath: string;

  constructor(
    private readonly baseDir: string = '.t-agent/memory',
  ) {
    this.entriesDir = path.join(baseDir, 'entries');
    this.indexPath = path.join(baseDir, 'index.json');
  }

  async set(
    key: string,
    content: string,
    tags?: string[],
  ): Promise<void> {
    await fs.mkdir(this.entriesDir, { recursive: true });

    const existing = await this.get(key);
    const now = new Date().toISOString();

    const entry: StoredEntry = {
      key,
      content,
      createdAt: existing?.createdAt.toISOString() ?? now,
      updatedAt: now,
      tags,
    };

    await fs.writeFile(
      this.getEntryPath(key),
      JSON.stringify(entry, null, 2),
      'utf-8',
    );

    // 更新索引
    await this.updateIndex(key, { tags, updatedAt: now });
  }

  async get(key: string): Promise<MemoryEntry | null> {
    try {
      const content = await fs.readFile(this.getEntryPath(key), 'utf-8');
      const stored = JSON.parse(content) as StoredEntry;
      return this.toMemoryEntry(stored);
    } catch {
      return null;
    }
  }

  async search(tags?: string[]): Promise<MemoryEntry[]> {
    const all = await this.list();
    if (!tags || tags.length === 0) {
      return all;
    }
    return all.filter((entry) =>
      tags.some((tag) => entry.tags?.includes(tag)),
    );
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.getEntryPath(key));
    } catch {
      // 文件不存在也不报错
    }

    // 从索引中移除
    await this.removeFromIndex(key);
  }

  async list(): Promise<MemoryEntry[]> {
    try {
      const files = await fs.readdir(this.entriesDir);
      const entries: MemoryEntry[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const content = await fs.readFile(
            path.join(this.entriesDir, file),
            'utf-8',
          );
          const stored = JSON.parse(content) as StoredEntry;
          entries.push(this.toMemoryEntry(stored));
        } catch {
          // 跳过损坏的文件
        }
      }

      // 按更新时间降序
      entries.sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );

      return entries;
    } catch {
      return [];
    }
  }

  private getEntryPath(key: string): string {
    // 将 key 中的特殊字符替换为安全的文件名字符
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.entriesDir, `${safeKey}.json`);
  }

  private toMemoryEntry(stored: StoredEntry): MemoryEntry {
    return {
      key: stored.key,
      content: stored.content,
      createdAt: new Date(stored.createdAt),
      updatedAt: new Date(stored.updatedAt),
      tags: stored.tags,
    };
  }

  private async updateIndex(
    key: string,
    data: { tags?: string[]; updatedAt: string },
  ): Promise<void> {
    const index = await this.loadIndex();
    index.entries[key] = data;
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(index, null, 2),
      'utf-8',
    );
  }

  private async removeFromIndex(key: string): Promise<void> {
    const index = await this.loadIndex();
    delete index.entries[key];
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(index, null, 2),
      'utf-8',
    );
  }

  private async loadIndex(): Promise<MemoryIndex> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      return JSON.parse(content) as MemoryIndex;
    } catch {
      return { entries: {} };
    }
  }
}
