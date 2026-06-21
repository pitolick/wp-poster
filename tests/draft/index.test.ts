import { describe, it, expect } from 'vitest';
import { parseDraft, validateDraft, readFrontmatter } from '../../src/draft/index.js';

const validMd = `---
title: テスト記事
status: draft
categories:
  - 漫画
tags:
  - セール
---

## 本文

ここに本文`;

describe('parseDraft', () => {
  it('正常な Markdown を PostInput に変換する', () => {
    const result = parseDraft(validMd);
    expect(result.errors).toEqual([]);
    expect(result.input).not.toBeNull();
    expect(result.input!.title).toBe('テスト記事');
    expect(result.input!.status).toBe('draft');
    expect(result.input!.categories).toEqual(['漫画']);
    expect(result.input!.content).toContain('## 本文');
  });

  it('title が無いと input=null で errors に乗る', () => {
    const md = `---
status: draft
---

本文`;
    const result = parseDraft(md);
    expect(result.input).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('未知のキーは warnings に乗るが input は返る', () => {
    const md = `---
title: タイトル
customField:
  foo: bar
---

本文`;
    const result = parseDraft(md);
    expect(result.input).not.toBeNull();
    expect(result.warnings).toContain('unknown frontmatter key: customField');
    expect(result.errors).toEqual([]);
  });

  it('source キー（orchestrator 用トレースメタ）は warnings を出さず、PostInput にも含めない', () => {
    const md = `---
title: タイトル
source:
  generator: claude-routine
  skill: e-comi-sale-check
---

本文`;
    const result = parseDraft(md);
    expect(result.input).not.toBeNull();
    expect(result.warnings).not.toContain('unknown frontmatter key: source');
    expect(result.errors).toEqual([]);
    expect(result.input).not.toHaveProperty('source');
  });

  it('壊れた YAML は errors に乗り input=null', () => {
    const md = `---
title: [unclosed
---

本文`;
    const result = parseDraft(md);
    expect(result.input).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('validateDraft', () => {
  it('正常な Markdown は ok=true', () => {
    const result = validateDraft(validMd);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('title 欠落は ok=false', () => {
    const md = `---
status: draft
---

本文`;
    const result = validateDraft(md);
    expect(result.ok).toBe(false);
  });

  it('壊れた YAML は ok=false', () => {
    const result = validateDraft('---\nbad: [yaml\n---\n本文');
    expect(result.ok).toBe(false);
  });
});

describe('readFrontmatter', () => {
  it('未知キー（products）を含む frontmatter と本文を返す', () => {
    const md = [
      '---',
      'title: T',
      'slug: s',
      'products:',
      '  - title: P1',
      '    listings:',
      '      - platform: dmm-books',
      '        external_id: b950rshes00197',
      '---',
      '本文 [affilicard platform="dmm-books" external-id="b950rshes00197"]',
      '',
    ].join('\n');

    const { frontmatter, body } = readFrontmatter(md);

    expect(frontmatter.title).toBe('T');
    expect(Array.isArray(frontmatter.products)).toBe(true);
    expect((frontmatter.products as Array<{ title: string }>)[0].title).toBe('P1');
    expect(body).toContain('[affilicard platform="dmm-books" external-id="b950rshes00197"]');
  });
});
