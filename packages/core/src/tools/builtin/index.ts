/**
 * 内置工具集 -- 框架提供的基础工具
 *
 * 包含文件操作、shell 执行、代码搜索和网页获取。
 * 通过 SDK 的 Extension 机制或直接注册使用。
 */

export { readFile } from './read-file.js';
export { writeFile } from './write-file.js';
export { listDirectory } from './list-directory.js';
export { executeShell } from './execute-shell.js';
export { grep } from './grep.js';
export { webFetch } from './web-fetch.js';
