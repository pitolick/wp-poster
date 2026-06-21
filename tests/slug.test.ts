import { describe, it, expect } from 'vitest';
import { sanitizeSlug } from '../src/slug.js';

describe('sanitizeSlug', () => {
  it('英数はそのまま結合する', () => {
    expect(sanitizeSlug('dmm-books-b950rshes00197')).toBe('dmm-books-b950rshes00197');
    expect(sanitizeSlug('dmm-books-828443')).toBe('dmm-books-828443');
  });

  it('大文字を小文字化する', () => {
    expect(sanitizeSlug('DMM-Books-ABC123')).toBe('dmm-books-abc123');
  });

  it('英数以外の記号はハイフンに畳み、前後・連続ハイフンを整理する', () => {
    expect(sanitizeSlug('foo/bar  baz')).toBe('foo-bar-baz');
    expect(sanitizeSlug('--a__b--')).toBe('a-b');
  });

  it('冪等である（2 回適用しても変わらない）', () => {
    const once = sanitizeSlug('Foo / Bar');
    expect(sanitizeSlug(once)).toBe(once);
  });

  it('アクセント・ダイアクリティカルを除去する', () => {
    expect(sanitizeSlug('Café Crème')).toBe('cafe-creme');
  });
});
