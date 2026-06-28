import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/draft/parser.js';

describe('parseFrontmatter', () => {
  it('YAML frontmatter と本文を分離する', () => {
    const md = `---
title: テスト
status: draft
---

## 本文

これは本文です。`;
    const { frontmatter, content } = parseFrontmatter(md);
    expect(frontmatter).toEqual({ title: 'テスト', status: 'draft' });
    expect(content).toContain('## 本文');
    expect(content).toContain('これは本文です。');
  });

  it('frontmatter が無い場合は frontmatter={} で本文だけ返す', () => {
    const md = '## ただの Markdown\n\n本文だけ';
    const { frontmatter, content } = parseFrontmatter(md);
    expect(frontmatter).toEqual({});
    expect(content).toContain('## ただの Markdown');
  });

  it('frontmatter が空オブジェクトの場合 frontmatter={}', () => {
    const md = `---
---

本文`;
    const { frontmatter, content } = parseFrontmatter(md);
    expect(frontmatter).toEqual({});
    expect(content).toBe('本文');
  });

  it('ネストした YAML を保持する', () => {
    const md = `---
title: テスト
featuredImage:
  source: https://example.com/a.jpg
  alt: 表紙
---

body`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter).toEqual({
      title: 'テスト',
      featuredImage: { source: 'https://example.com/a.jpg', alt: '表紙' },
    });
  });

  it('配列の YAML を保持する', () => {
    const md = `---
title: テスト
categories:
  - 漫画
  - セール
tags: [a, b]
---

body`;
    const { frontmatter } = parseFrontmatter(md);
    expect(frontmatter).toEqual({
      title: 'テスト',
      categories: ['漫画', 'セール'],
      tags: ['a', 'b'],
    });
  });

  it('壊れた YAML は ParseError を投げる', () => {
    const md = `---
title: [unclosed
---

body`;
    expect(() => parseFrontmatter(md)).toThrow();
  });

  it('content は trim される', () => {
    const md = `---
title: x
---


   body with surrounding whitespace

`;
    const { content } = parseFrontmatter(md);
    expect(content).toBe('body with surrounding whitespace');
  });

  it('引用符なし日付（YAML timestamp）を ISO8601 文字列へ正規化する', () => {
    const md = `---
title: x
date: 2026-05-21
---

body`;
    const { frontmatter } = parseFrontmatter(md);
    expect(typeof frontmatter.date).toBe('string');
    expect(frontmatter.date).toMatch(/^2026-05-21T/);
  });

  it('ネストした引用符なし日付も文字列へ正規化する', () => {
    const md = `---
title: x
source:
  generated_at: 2026-05-21T10:00:00.000Z
---

body`;
    const { frontmatter } = parseFrontmatter(md);
    const source = frontmatter.source as Record<string, unknown>;
    expect(typeof source.generated_at).toBe('string');
  });
});
