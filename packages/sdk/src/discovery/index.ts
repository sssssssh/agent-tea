/**
 * Discovery 模块 —— 文件系统 Skill/Agent 自动发现
 */

export { discover } from './discover.js';
export { ToolResolver } from './tool-resolver.js';
export { parseSkillFile, parseAgentFile } from './parser.js';
export { scanSkillDirs, scanAgentDirs, mergeByName } from './loader.js';
export type {
  DiscoveryConfig,
  DiscoveredAssets,
  SkillFrontmatter,
  AgentFrontmatter,
  ParsedSkill,
  ParsedAgent,
} from './types.js';
