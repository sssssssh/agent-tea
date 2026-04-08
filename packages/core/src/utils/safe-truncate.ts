/**
 * UTF-16 安全的字符串截断。
 *
 * JavaScript 的 string.slice() 按 UTF-16 code unit 切割，
 * 可能把 surrogate pair（如 emoji）切成一半导致乱码。
 * 此函数确保截断位置不会落在 surrogate pair 中间。
 */
export function safeTruncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    if (maxLength <= 0) return '';

    // 检查截断位置是否落在 high surrogate 上
    // high surrogate: 0xD800–0xDBFF
    const charAtBoundary = str.charCodeAt(maxLength - 1);
    if (charAtBoundary >= 0xd800 && charAtBoundary <= 0xdbff) {
        // 截断位置是 high surrogate，后退一位避免切断 pair
        return str.slice(0, maxLength - 1);
    }

    return str.slice(0, maxLength);
}
