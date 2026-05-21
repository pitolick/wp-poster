import { describe, it, expect } from 'vitest';
import { parseDraft, validateDraft } from '../../src/draft/index.js';

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
source:
  generator: claude-routine
---

本文`;
    const result = parseDraft(md);
    expect(result.input).not.toBeNull();
    expect(result.warnings).toContain('unknown frontmatter key: source');
    expect(result.errors).toEqual([]);
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
