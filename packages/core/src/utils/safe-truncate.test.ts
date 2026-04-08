import { describe, it, expect } from 'vitest';
import { safeTruncate } from './safe-truncate.js';

describe('safeTruncate', () => {
    it('should not truncate short strings', () => {
        expect(safeTruncate('hello', 10)).toBe('hello');
    });

    it('should truncate ASCII strings at exact boundary', () => {
        expect(safeTruncate('abcdef', 3)).toBe('abc');
    });

    it('should not split surrogate pairs (emoji)', () => {
        // 🎉 is a surrogate pair (2 UTF-16 code units)
        const str = 'ab🎉cd';
        // str.length is 6 (a, b, high surrogate, low surrogate, c, d)
        // slice(0, 3) would give 'ab' + high surrogate (broken)
        const result = safeTruncate(str, 3);
        // Should stop before the emoji to avoid breaking it
        expect(result).toBe('ab');
    });

    it('should include full emoji when maxLength covers both code units', () => {
        const str = 'ab🎉cd';
        // maxLength=4 covers a, b, high, low surrogate
        const result = safeTruncate(str, 4);
        expect(result).toBe('ab🎉');
    });

    it('should handle CJK characters safely', () => {
        const str = '你好世界测试';
        const result = safeTruncate(str, 4);
        // CJK chars are single code units in UTF-16, safe to slice
        expect(result).toBe('你好世界');
    });

    it('should handle mixed content', () => {
        const str = 'Hello 你好 🎉 world';
        const result = safeTruncate(str, 9);
        // Should not end with a broken surrogate
        expect(result).not.toMatch(/[\uD800-\uDBFF]$/);
    });

    it('should return empty string for maxLength 0', () => {
        expect(safeTruncate('hello', 0)).toBe('');
    });

    it('should handle string of only emojis', () => {
        const str = '🎉🎊🎈';
        // Each emoji is 2 code units, str.length = 6
        const result = safeTruncate(str, 3);
        // Can fit first emoji (2 units), but 3rd position is high surrogate of 2nd emoji
        expect(result).toBe('🎉');
    });
});
