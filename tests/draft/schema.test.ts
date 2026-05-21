import { describe, it, expect } from 'vitest';
import { validateFrontmatter } from '../../src/draft/schema.js';

describe('validateFrontmatter', () => {
  it('title だけあれば ok=true', () => {
    const r = validateFrontmatter({ title: 'テスト' });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('title が無いと ok=false で errors に乗る', () => {
    const r = validateFrontmatter({});
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('title is required and must be a non-empty string');
  });

  it('title が空文字列なら ok=false', () => {
    const r = validateFrontmatter({ title: '' });
    expect(r.ok).toBe(false);
  });

  it('title が string でなければ ok=false', () => {
    const r = validateFrontmatter({ title: 123 });
    expect(r.ok).toBe(false);
  });

  it('status が許可された値なら ok=true', () => {
    for (const s of ['draft', 'publish', 'future', 'pending', 'private']) {
      const r = validateFrontmatter({ title: 't', status: s });
      expect(r.ok).toBe(true);
    }
  });

  it('status が未知の値なら ok=false', () => {
    const r = validateFrontmatter({ title: 't', status: 'unknown' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('status'))).toBe(true);
  });

  it('author が number 以外なら ok=false', () => {
    const r = validateFrontmatter({ title: 't', author: 'abc' });
    expect(r.ok).toBe(false);
  });

  it('categories が string[] でなければ ok=false', () => {
    const r = validateFrontmatter({ title: 't', categories: 'manga' });
    expect(r.ok).toBe(false);
  });

  it('categories の要素が string でなければ ok=false', () => {
    const r = validateFrontmatter({ title: 't', categories: ['ok', 123] });
    expect(r.ok).toBe(false);
  });

  it('featuredImage に source が無ければ ok=false', () => {
    const r = validateFrontmatter({ title: 't', featuredImage: { alt: 'no source' } });
    expect(r.ok).toBe(false);
  });

  it('featuredImage が null なら ok=true（明示的にアイキャッチなし）', () => {
    const r = validateFrontmatter({ title: 't', featuredImage: null });
    expect(r.ok).toBe(true);
  });

  it('meta の値は string / number / boolean のみ', () => {
    const r1 = validateFrontmatter({ title: 't', meta: { a: 'x', b: 1, c: true } });
    expect(r1.ok).toBe(true);
    const r2 = validateFrontmatter({ title: 't', meta: { a: { nested: 1 } } });
    expect(r2.ok).toBe(false);
  });

  it('未知のトップレベルキーは warnings に乗る（errors にはならない）', () => {
    const r = validateFrontmatter({ title: 't', source: { generator: 'claude-routine' } });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain('unknown frontmatter key: source');
  });
});
