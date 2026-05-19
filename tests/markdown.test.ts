import { describe, it, expect } from 'vitest';
import { markdownToBlocks } from '../src/markdown.js';

describe('markdownToBlocks: 基本ブロック', () => {
  it('段落を core/paragraph で出力', () => {
    const out = markdownToBlocks('Hello world.');
    expect(out).toContain('<!-- wp:paragraph -->');
    expect(out).toContain('<p>Hello world.</p>');
    expect(out).toContain('<!-- /wp:paragraph -->');
  });

  it('H1〜H4 を core/heading で出力（level 属性付き）', () => {
    const out = markdownToBlocks('# Title\n\n## Sub\n\n### Inner\n\n#### Deep');
    expect(out).toContain('<!-- wp:heading {"level":1} -->');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<!-- wp:heading {"level":2} -->');
    expect(out).toContain('<h2>Sub</h2>');
    expect(out).toContain('<!-- wp:heading {"level":3} -->');
    expect(out).toContain('<!-- wp:heading {"level":4} -->');
  });

  it('水平線を core/separator で出力', () => {
    const out = markdownToBlocks('foo\n\n---\n\nbar');
    expect(out).toContain('<!-- wp:separator -->');
    expect(out).toContain('<hr class="wp-block-separator"/>');
    expect(out).toContain('<!-- /wp:separator -->');
  });

  it('改行で複数ブロックを区切る', () => {
    const out = markdownToBlocks('A\n\nB');
    const matches = out.match(/<!-- wp:paragraph -->/g);
    expect(matches?.length).toBe(2);
  });
});
