/**
 * 02 - 内置工具：用框架自带的工具创建文件助手
 *
 * 前置知识：01-hello-agent（Agent、tool、事件消费）
 *
 * 本示例新概念：
 * - 内置工具：框架预定义的常用工具（readFile, listDirectory, grep 等）
 * - builtinTools extension：一次性引入全部内置工具的快捷方式
 * - Extension：可复用的能力包，打包工具 + 指令
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/02-builtin-tools.ts
 *
 *   # 自定义问题：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/02-builtin-tools.ts "读取 package.json 文件"
 */

import { Agent, readFile, listDirectory, grep, builtinTools } from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// 内置工具有两种使用方式
// ============================================================

// 方式 1：按需引入单个工具
// 适合只需要部分工具、或想精确控制 Agent 能力的场景
// 可用工具：readFile, writeFile, listDirectory, executeShell, grep, webFetch
const fileAssistant = new Agent({
    provider: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
    }),
    model: process.env.MODEL || 'gpt-4o-mini',
    // 只给 Agent 文件读取和搜索能力，不给写入和执行权限
    tools: [readFile, listDirectory, grep],
    systemPrompt: `你是一个文件助手，可以帮用户浏览目录、读取文件和搜索代码。
请用中文回答，展示关键信息即可，不需要把整个文件内容贴出来。`,
});

// 方式 2：通过 builtinTools extension 一次性引入全部工具
// Extension 是一个能力包，包含一组工具和使用指令
// builtinTools.tools 包含全部 6 个内置工具
// builtinTools.instructions 会被注入到 system prompt 中，告诉 LLM 如何使用这些工具
//
// 示例（仅展示创建方式，本示例实际运行用方式 1 的 fileAssistant）：
// const fullAgent = new Agent({
//   provider: new OpenAIProvider({ ... }),
//   model: 'gpt-4o-mini',
//   tools: builtinTools.tools,
//   systemPrompt: builtinTools.instructions,
// });
//
// Extension 的 tools 属性是一个 Tool[] 数组，可以直接展开或和自定义工具混用：
// tools: [...builtinTools.tools!, myCustomTool]

console.log('内置工具 Extension 信息：');
console.log(`  名称: ${builtinTools.name}`);
console.log(`  描述: ${builtinTools.description}`);
console.log(`  包含工具: ${builtinTools.tools!.map((t) => t.name).join(', ')}`);
console.log();

// ============================================================
// 用方式 1 的 Agent 来演示文件浏览能力
// ============================================================

async function main() {
    const query =
        process.argv[2] || '列出 packages/ 目录下有哪些子包，然后读取其中一个包的 package.json';
    console.log(`> ${query}\n`);

    for await (const event of fileAssistant.run(query)) {
        switch (event.type) {
            case 'message':
                console.log(`[助手] ${event.content}`);
                break;

            case 'tool_request':
                console.log(`[工具调用] ${event.toolName}(${JSON.stringify(event.args)})`);
                break;

            case 'tool_response':
                // 文件内容可能很长，截取前 200 字符展示
                const preview =
                    event.content.length > 200
                        ? event.content.slice(0, 200) + '...'
                        : event.content;
                console.log(`[工具结果] ${preview}`);
                break;

            case 'error':
                console.error(`[错误] ${event.message}`);
                break;
        }
    }

    console.log('\n完成。');
}

main().catch(console.error);
