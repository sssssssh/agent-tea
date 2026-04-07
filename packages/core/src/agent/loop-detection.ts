/**
 * 循环检测模块
 *
 * 检测 Agent 在执行过程中是否陷入循环，包含两种检测策略：
 * 1. 工具调用循环 —— 连续多次调用相同工具+相同参数
 * 2. 内容重复循环 —— LLM 反复生成相似的文本内容
 *
 * 设计要点：
 * - ToolCallTracker 基于工具名+排序后参数的 hash 做精确匹配
 * - ContentTracker 将文本切成固定长度的块，用简单数字 hash 追踪出现频率和间距规律
 * - LoopDetector 整合两个 tracker，支持警告→终止的分级策略
 *
 * 架构位置：Core 层 Agent 子模块，被 BaseAgent 在循环中调用。
 */

// ---- 配置 ----

export interface LoopDetectionConfig {
    /** 是否启用循环检测（默认 true） */
    enabled: boolean;
    /** 连续相同工具调用的阈值（默认 3） */
    maxConsecutiveIdenticalCalls: number;
    /** 内容块重复出现次数的阈值（默认 5） */
    contentRepetitionThreshold: number;
    /** 最大警告次数，超过后将终止 Agent（默认 1） */
    maxWarnings: number;
}

export const DEFAULT_LOOP_DETECTION_CONFIG: LoopDetectionConfig = {
    enabled: true,
    maxConsecutiveIdenticalCalls: 3,
    contentRepetitionThreshold: 5,
    maxWarnings: 1,
};

// ---- 检测结果 ----

export interface LoopCheckResult {
    looping: boolean;
    type?: 'tool_call' | 'content';
    action?: 'warn' | 'abort';
}

// ---- 工具调用追踪器 ----

/**
 * 追踪连续相同的工具调用。
 *
 * 将工具名 + 参数序列化为 hash，连续调用相同 hash 时计数递增。
 * 一旦 LLM 产出文本响应（非工具调用），计数重置。
 */
export class ToolCallTracker {
    private lastHash: string = '';
    private consecutiveCount: number = 0;

    /**
     * 生成工具调用的 hash。
     * 对 args 的 key 排序后序列化，确保参数顺序不同但值相同时产生相同 hash。
     */
    private hash(toolName: string, args: unknown): string {
        const sortedArgs = JSON.stringify(
            args,
            Object.keys(args as Record<string, unknown>).sort(),
        );
        return `${toolName}::${sortedArgs}`;
    }

    track(toolName: string, args: unknown): void {
        const h = this.hash(toolName, args);
        if (h === this.lastHash) {
            this.consecutiveCount++;
        } else {
            this.lastHash = h;
            this.consecutiveCount = 1;
        }
    }

    isLooping(threshold: number): boolean {
        return this.consecutiveCount >= threshold;
    }

    /** LLM 产出文本时调用，打断连续工具调用的计数 */
    reset(): void {
        this.lastHash = '';
        this.consecutiveCount = 0;
    }
}

// ---- 内容重复追踪器 ----

const CHUNK_SIZE = 50;

/**
 * 追踪 LLM 输出的文本内容是否出现周期性重复。
 *
 * 将文本（去除代码块后）切成固定长度的块，对每个块计算简单数字 hash，
 * 记录每个 hash 出现的位置。当某个 hash 出现次数达到阈值，
 * 且出现间距呈现规律性（方差小、间距短），判定为内容循环。
 */
export class ContentTracker {
    /** hash → 出现位置列表（位置 = 累计已处理的 chunk 数） */
    private occurrences = new Map<string, number[]>();
    /** 已处理的 chunk 总数，作为位置计数器 */
    private position: number = 0;

    /**
     * 简单数字 hash（djb2 变体）。
     * 不需要加密安全性，只需要分布均匀、碰撞率低。
     */
    private simpleHash(str: string): string {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        }
        return hash.toString(36);
    }

    /** 去除 markdown 代码块（```...```），避免代码内容干扰重复检测 */
    private stripCodeBlocks(text: string): string {
        return text.replace(/```[\s\S]*?```/g, '');
    }

    track(content: string): void {
        const stripped = this.stripCodeBlocks(content);

        // 将文本切成 CHUNK_SIZE 长度的块
        for (let i = 0; i <= stripped.length - CHUNK_SIZE; i += CHUNK_SIZE) {
            const chunk = stripped.slice(i, i + CHUNK_SIZE);
            const h = this.simpleHash(chunk);

            let positions = this.occurrences.get(h);
            if (!positions) {
                positions = [];
                this.occurrences.set(h, positions);
            }
            positions.push(this.position);
            this.position++;
        }
    }

    /**
     * 判断是否存在内容循环。
     *
     * 条件：某个 chunk hash 出现次数 >= threshold，
     * 且出现间距具有规律性（gap 方差 < avgGap * 0.3），
     * 且平均间距不太大（avgGap < CHUNK_SIZE * 5）。
     */
    isLooping(threshold: number): boolean {
        for (const positions of this.occurrences.values()) {
            if (positions.length < threshold) continue;

            // 计算相邻出现位置的间距
            const gaps: number[] = [];
            for (let i = 1; i < positions.length; i++) {
                gaps.push(positions[i] - positions[i - 1]);
            }

            if (gaps.length === 0) continue;

            const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

            // 平均间距过大，说明重复不密集，不算循环
            if (avgGap >= CHUNK_SIZE * 5) continue;

            // 计算 gap 方差，方差小说明间距均匀（周期性重复）
            const variance = gaps.reduce((sum, g) => sum + (g - avgGap) ** 2, 0) / gaps.length;

            if (variance < avgGap * 0.3) {
                return true;
            }
        }

        return false;
    }
}

// ---- 整合检测器 ----

/**
 * 循环检测器，整合工具调用和内容重复两种检测策略。
 *
 * 分级响应：首次检测到循环时发出警告（让 LLM 有机会自我修正），
 * 超过 maxWarnings 次后终止 Agent。
 */
export class LoopDetector {
    private toolTracker = new ToolCallTracker();
    private contentTracker = new ContentTracker();
    private warningCount = 0;

    constructor(private config: LoopDetectionConfig) {}

    trackToolCall(name: string, args: unknown): void {
        this.toolTracker.track(name, args);
    }

    /** 追踪文本内容，同时重置工具调用连续计数（LLM 产出了文本说明不是纯工具调用循环） */
    trackContent(content: string): void {
        this.toolTracker.reset();
        this.contentTracker.track(content);
    }

    check(): LoopCheckResult {
        if (!this.config.enabled) {
            return { looping: false };
        }

        // 优先检查工具调用循环（更确定性的信号）
        if (this.toolTracker.isLooping(this.config.maxConsecutiveIdenticalCalls)) {
            return this.escalate('tool_call');
        }

        if (this.contentTracker.isLooping(this.config.contentRepetitionThreshold)) {
            return this.escalate('content');
        }

        return { looping: false };
    }

    /** 分级响应：警告次数未超限则警告，超限则终止 */
    private escalate(type: 'tool_call' | 'content'): LoopCheckResult {
        this.warningCount++;
        const action = this.warningCount <= this.config.maxWarnings ? 'warn' : 'abort';
        return { looping: true, type, action };
    }
}
