/**
 * ToolRegistry —— 工具注册表
 *
 * 职责：
 * 1. 管理工具的注册、查找和生命周期
 * 2. 将 Zod Schema 转为 JSON Schema，生成 LLM 所需的 ToolDefinition
 *
 * 为什么需要注册表而不是简单的数组？
 * - 防止工具名称冲突（同名工具会导致 LLM 调用歧义）
 * - 提供 O(1) 的名称查找（Agent 循环中频繁按名称查找工具）
 * - 集中管理 Zod → JSON Schema 的转换逻辑
 *
 * 架构位置：Core 层的 Tool 子模块，由 Agent 在初始化时创建和填充。
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinition } from '../llm/types.js';
import type { Tool } from './types.js';

export class ToolRegistry {
    /** 使用 Map 而非数组，确保按名称查找的 O(1) 性能 */
    private tools = new Map<string, Tool>();

    /** 注册工具，名称冲突时直接抛错（快速暴露配置问题） */
    register(tool: Tool): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered`);
        }
        this.tools.set(tool.name, tool);
    }

    unregister(name: string): boolean {
        return this.tools.delete(name);
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    getAll(): Tool[] {
        return Array.from(this.tools.values());
    }

    getNames(): string[] {
        return Array.from(this.tools.keys());
    }

    get size(): number {
        return this.tools.size;
    }

    /**
     * 将所有工具导出为 LLM 可识别的 ToolDefinition（JSON Schema 格式）。
     * 使用 openApi3 target 是因为大部分 LLM API 更好地支持 OpenAPI 3.0 格式。
     * $refStrategy: 'none' 确保输出是展平的 Schema，避免 $ref 引用导致 LLM 解析失败。
     */
    toToolDefinitions(): ToolDefinition[] {
        return this.getAll().map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: zodToJsonSchema(tool.parameters, {
                $refStrategy: 'none',
                target: 'openApi3',
            }) as Record<string, unknown>,
        }));
    }

    clear(): void {
        this.tools.clear();
    }
}
