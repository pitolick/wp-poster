import { describe, it, expect } from 'vitest';
import { adaptToPostInput } from '../../src/draft/adapter.js';
import type { DraftFrontmatter } from '../../src/draft/schema.js';

describe('adaptToPostInput', () => {
  it('title と content のみ必須', () => {
    const fm: DraftFrontmatter = { title: 'タイトル' };
    const input = adaptToPostInput(fm, '本文');
    expect(input).toEqual({ title: 'タイトル', content: '本文' });
  });

  it('frontmatter の全フィールドが PostInput に転写される', () => {
    const fm: DraftFrontmatter = {
      title: 'タイトル',
      slug: 'my-slug',
      status: 'publish',
      date: '2026-05-21T19:00:00+09:00',
      excerpt: '抜粋',
      author: 1,
      categories: ['漫画'],
      tags: ['セール'],
      featuredImage: { source: 'https://example.com/x.jpg', alt: '画像' },
      meta: { rank_math_title: 'SEO' },
    };
    const input = adaptToPostInput(fm, '本文');
    expect(input).toEqual({
      title: 'タイトル',
      content: '本文',
      slug: 'my-slug',
      status: 'publish',
      date: '2026-05-21T19:00:00+09:00',
      excerpt: '抜粋',
      author: 1,
      categories: ['漫画'],
      tags: ['セール'],
      featuredImage: { source: 'https://example.com/x.jpg', alt: '画像' },
      meta: { rank_math_title: 'SEO' },
    });
  });

  it('featuredImage が null なら featuredImage: null を保持する', () => {
    const input = adaptToPostInput({ title: 't', featuredImage: null }, '本文');
    expect(input.featuredImage).toBeNull();
  });

  it('未定義フィールドは PostInput に含めない', () => {
    const input = adaptToPostInput({ title: 't' }, 'b');
    expect(input).not.toHaveProperty('status');
    expect(input).not.toHaveProperty('date');
    expect(input).not.toHaveProperty('categories');
  });

  it('source キーは PostInput に含めない（orchestrator 用トレースメタ、WP には送らない）', () => {
    const fm: DraftFrontmatter = {
      title: 't',
      source: { generator: 'claude-routine', skill: 'e-comi-sale-check' },
    };
    const input = adaptToPostInput(fm, '本文');
    expect(input).not.toHaveProperty('source');
    expect(input).toEqual({ title: 't', content: '本文' });
  });
});
