/**
 * 示例 09 — Extension 与 Skill（扩展和技能）
 *
 * 前置知识：01-basic-agent（Agent 基本用法）、02 或 basic-agent（工具定义）
 * 新概念：
 *   - extension() —— 可复用的能力包，将工具 + 指令打包为领域插件
 *   - skill() —— 面向特定任务的"提示词 + 工具"配方，支持触发命令
 *   - builtinTools —— 框架内置工具扩展（文件操作、shell、grep 等）
 *   - 手动展开 Extension/Skill 到 Agent config（当前框架的使用方式）
 *
 * 场景：一个多技能助手
 *   - 天气扩展（Extension）—— 包含天气查询和预报两个工具
 *   - 代码审查技能（Skill）—— 用 /review 触发，配备代码分析工具
 *   - 内置工具扩展 —— 展示 builtinTools 的用法
 *
 * 运行方式：
 *   OPENAI_API_KEY=sk-xxx npx tsx examples/09-extension-and-skill.ts
 *   OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=https://your-api.com/v1 MODEL=your-model npx tsx examples/09-extension-and-skill.ts
 */

import {
  Agent,
  extension,
  skill,
  tool,
  z,
  builtinTools,
} from '../packages/sdk/src/index.js';
import { OpenAIProvider } from '../packages/provider-openai/src/index.js';

// ============================================================
// Part 1: Extension —— 天气查询能力包
// ============================================================

// 模拟天气数据
const weatherData: Record<string, { temp: number; condition: string; humidity: number }> = {
  '北京': { temp: 22, condition: '晴', humidity: 35 },
  '上海': { temp: 26, condition: '多云', humidity: 65 },
  '深圳': { temp: 30, condition: '雷阵雨', humidity: 85 },
  '杭州': { temp: 24, condition: '阴', humidity: 70 },
  '成都': { temp: 20, condition: '小雨', humidity: 75 },
};

// 模拟预报数据
const forecastData: Record<string, string[]> = {
  '北京': ['明天: 晴转多云 18-25°C', '后天: 多云 16-23°C', '大后天: 小雨 14-20°C'],
  '上海': ['明天: 阴 22-28°C', '后天: 小雨 20-26°C', '大后天: 多云 21-27°C'],
  '深圳': ['明天: 雷阵雨 26-32°C', '后天: 多云 27-33°C', '大后天: 晴 28-34°C'],
  '杭州': ['明天: 多云 20-26°C', '后天: 晴 22-28°C', '大后天: 晴 23-29°C'],
  '成都': ['明天: 阴 17-22°C', '后天: 小雨 16-21°C', '大后天: 多云 18-24°C'],
};

// 天气查询工具
const getWeather = tool(
  {
    name: 'get_weather',
    description: '查询指定城市的当前天气',
    parameters: z.object({
      city: z.string().describe('城市名称，如"北京"、"上海"'),
    }),
  },
  async ({ city }) => {
    const data = weatherData[city];
    if (!data) return { content: `暂不支持查询 ${city} 的天气`, isError: true };
    return `${city} 当前天气: ${data.condition}, 气温 ${data.temp}°C, 湿度 ${data.humidity}%`;
  },
);

// 天气预报工具
const getForecast = tool(
  {
    name: 'get_forecast',
    description: '查询指定城市未来三天的天气预报',
    parameters: z.object({
      city: z.string().describe('城市名称'),
    }),
  },
  async ({ city }) => {
    const forecast = forecastData[city];
    if (!forecast) return { content: `暂不支持查询 ${city} 的天气预报`, isError: true };
    return `${city} 未来三天预报:\n${forecast.join('\n')}`;
  },
);

// 将天气相关工具打包为 Extension
// Extension = 工具 + 指令 的可复用单元，类似"插件"
const weatherExt = extension({
  name: 'weather',
  description: '天气查询能力 —— 支持实时天气和未来三天预报',
  instructions: '当用户询问天气时，使用天气工具查询。温度统一使用摄氏度。支持的城市：北京、上海、深圳、杭州、成都。',
  tools: [getWeather, getForecast],
});

// ============================================================
// Part 2: Skill —— 代码审查技能
// ============================================================

// 模拟代码分析工具（实际场景中可以用内置的 readFile / grep）
const analyzeCode = tool(
  {
    name: 'analyze_code',
    description: '分析代码片段，检查常见问题',
    parameters: z.object({
      code: z.string().describe('要分析的代码片段'),
      language: z.string().optional().describe('编程语言，如 "typescript"、"python"'),
    }),
  },
  async ({ code, language }) => {
    // 简单的模拟分析
    const issues: string[] = [];

    if (code.includes('any')) issues.push('发现 any 类型，建议使用更具体的类型');
    if (code.includes('console.log')) issues.push('发现 console.log，生产代码应使用日志库');
    if (code.includes('TODO')) issues.push('发现 TODO 注释，建议创建 issue 跟踪');
    if (!code.includes('try') && code.includes('await')) {
      issues.push('异步操作缺少 try-catch 错误处理');
    }
    if (code.length > 500) issues.push('函数/代码块过长，建议拆分');

    const lang = language || '未指定';
    if (issues.length === 0) {
      return `代码分析 (${lang}): 未发现明显问题`;
    }
    return `代码分析 (${lang}) 发现 ${issues.length} 个问题:\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`;
  },
);

// 模拟代码复杂度计算工具
const measureComplexity = tool(
  {
    name: 'measure_complexity',
    description: '计算代码的复杂度指标',
    parameters: z.object({
      code: z.string().describe('要测量的代码片段'),
    }),
  },
  async ({ code }) => {
    // 简单模拟：按行数、嵌套深度、分支数估算
    const lines = code.split('\n').length;
    const branches = (code.match(/if|else|switch|case|for|while|\?/g) || []).length;
    const maxNesting = Math.min(
      (code.match(/{/g) || []).length,
      5,
    );

    return [
      `代码复杂度分析:`,
      `  行数: ${lines}`,
      `  分支数: ${branches}`,
      `  最大嵌套层级(估): ${maxNesting}`,
      `  综合评级: ${branches > 10 ? '高复杂度' : branches > 5 ? '中等复杂度' : '低复杂度'}`,
    ].join('\n');
  },
);

// 将代码审查相关工具打包为 Skill
// Skill = 面向特定任务的配方，trigger 支持用户用命令激活
const reviewSkill = skill({
  name: 'code-review',
  description: '代码审查技能 —— 分析代码质量、复杂度和潜在问题',
  instructions: `仔细分析代码，关注以下方面:
1. 类型安全 —— 是否有 any、类型断言等
2. 错误处理 —— 异步操作是否有 try-catch
3. 代码规范 —— 是否有 console.log、TODO 等
4. 复杂度 —— 函数是否过长、嵌套是否过深
用中文输出审查报告，给出改进建议。`,
  trigger: '/review', // 用户输入 /review 可激活此技能
  tools: [analyzeCode, measureComplexity],
});

// ============================================================
// Part 3: 组合到 Agent —— 手动展开 Extension 和 Skill
// ============================================================

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

// 注意：当前框架 Agent 还没有直接接受 extensions/skills 的 config 字段，
// 所以需要手动展开 tools 和 instructions。
// 这是 SDK 抽象的现状 —— Extension/Skill 目前是组织层面的抽象，
// 未来会提供 agent.use(extension) 之类的一等集成 API。

const agent = new Agent({
  provider,
  model: process.env.MODEL || 'gpt-4o-mini',

  // 合并所有来源的工具：天气扩展 + 代码审查技能
  tools: [
    ...(weatherExt.tools || []),
    ...(reviewSkill.tools || []),
  ],

  // 合并所有来源的指令到 system prompt
  systemPrompt: [
    '你是一个多技能助手，具备天气查询和代码审查能力。',
    '',
    `## 天气能力 (来自 ${weatherExt.name} 扩展)`,
    weatherExt.instructions || '',
    '',
    `## 代码审查能力 (来自 ${reviewSkill.name} 技能)`,
    reviewSkill.instructions,
    '',
    '用中文回答所有问题。',
  ].join('\n'),
});

// ============================================================
// 主流程
// ============================================================

async function main() {
  const query =
    process.argv[2] ||
    '先帮我查一下北京和深圳的天气，然后审查这段代码:\n\nasync function fetchData(url: any) {\n  console.log("fetching...");\n  const res = await fetch(url);\n  const data = await res.json();\n  // TODO: add error handling\n  return data;\n}';

  console.log('='.repeat(60));
  console.log('  Extension 与 Skill 演示');
  console.log('  天气扩展 + 代码审查技能 组合使用');
  console.log('='.repeat(60));
  console.log();

  // 展示加载的扩展和技能信息
  console.log(`已加载扩展: ${weatherExt.name} (${weatherExt.tools?.length || 0} 个工具)`);
  console.log(`已加载技能: ${reviewSkill.name} (触发词: ${reviewSkill.trigger})`);
  console.log(`内置工具扩展 builtinTools 包含: ${builtinTools.tools?.map((t) => t.name).join(', ')}`);
  console.log('  (本示例未加载 builtinTools，仅展示其内容)');
  console.log();
  console.log(`用户: ${query}`);
  console.log();

  for await (const event of agent.run(query)) {
    switch (event.type) {
      case 'message':
        console.log(`助手: ${event.content}`);
        break;

      case 'tool_request':
        console.log(`  [调用工具] ${event.toolName}(${JSON.stringify(event.args)})`);
        break;

      case 'tool_response':
        console.log(`  [工具结果] ${event.content}`);
        break;

      case 'usage':
        console.log(
          `  [Token 用量] 输入=${event.usage.inputTokens} 输出=${event.usage.outputTokens}`,
        );
        break;

      case 'error':
        console.error(`  [错误] ${event.message}`);
        break;

      case 'agent_end':
        console.log(`\nAgent 结束 (${event.reason})`);
        break;
    }
  }
}

main().catch(console.error);
