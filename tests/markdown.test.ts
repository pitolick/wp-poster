import { describe, it, expect } from 'vitest';
import { markdownToBlocks } from '../src/markdown.js';
import type { MarkerTransformer } from '../src/types.js';

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

describe('markdownToBlocks: 複合ブロック', () => {
  it('順序なしリストを core/list で出力', () => {
    const out = markdownToBlocks('- a\n- b\n- c');
    expect(out).toContain('<!-- wp:list -->');
    expect(out).toContain('<ul class="wp-block-list">');
    expect(out).toContain('<li>a</li>');
  });

  it('順序付きリストは ordered 属性付き', () => {
    const out = markdownToBlocks('1. one\n2. two');
    expect(out).toContain('<!-- wp:list {"ordered":true} -->');
    expect(out).toContain('<ol class="wp-block-list">');
  });

  it('引用ブロックを core/quote で出力', () => {
    const out = markdownToBlocks('> 名言\n> 続き');
    expect(out).toContain('<!-- wp:quote -->');
    expect(out).toContain('<blockquote class="wp-block-quote">');
  });

  it('コードブロックを core/code で出力', () => {
    const out = markdownToBlocks('```\nconst x = 1;\n```');
    expect(out).toContain('<!-- wp:code -->');
    expect(out).toContain('<pre class="wp-block-code"><code>');
    expect(out).toContain('const x = 1;');
  });

  it('独立した画像段落を core/image で出力', () => {
    const out = markdownToBlocks('![alt](https://example.com/x.jpg)');
    expect(out).toContain('<!-- wp:image -->');
    expect(out).toContain('<img src="https://example.com/x.jpg" alt="alt"');
  });

  it('画像の alt に含まれる " < & をエスケープして属性破断を防ぐ', () => {
    const out = markdownToBlocks('![A "B" <C> & D](https://example.com/x.jpg)');
    expect(out).toContain('alt="A &quot;B&quot; &lt;C&gt; &amp; D"');
    // 生の二重引用符が alt 属性内に漏れていない
    expect(out).not.toContain('alt="A "B"');
  });
});

const affilicardMarker: MarkerTransformer = {
  pattern: /\[affilicard id="(\d+)"\]/g,
  toBlock: (m) => `<!-- wp:shortcode -->\n[affilicard id="${m[1]}"]\n<!-- /wp:shortcode -->`,
};

describe('markdownToBlocks: マーカートランスフォーマー結合', () => {
  it('段落内のマーカーがショートコードブロックに変換される', () => {
    const md = '前文。\n\n[affilicard id="42"]\n\n後文。';
    const out = markdownToBlocks(md, { markerTransformers: [affilicardMarker] });
    expect(out).toContain('<!-- wp:shortcode -->');
    expect(out).toContain('[affilicard id="42"]');
    // プレースホルダが残らないこと
    expect(out).not.toContain('WPP_MARKER_');
    // 前文・後文は通常段落として残る
    expect(out).toContain('<p>前文。</p>');
    expect(out).toContain('<p>後文。</p>');
  });

  it('マーカーが wp:paragraph ブロックに入れ子になっていない', () => {
    // バグ: 単独段落のマーカーが <!-- wp:paragraph --> の中に wp:shortcode が
    // 入れ子になって出力されると Gutenberg がブロックを破棄する。
    const md = '前文。\n\n[affilicard id="42"]\n\n後文。';
    const out = markdownToBlocks(md, { markerTransformers: [affilicardMarker] });
    // wp:shortcode が wp:paragraph で包まれていない（直前の閉じが /wp:paragraph）
    const shortcodeStart = out.indexOf('<!-- wp:shortcode -->');
    expect(shortcodeStart).toBeGreaterThan(-1);
    const before = out.slice(0, shortcodeStart);
    const lastParagraphOpen = before.lastIndexOf('<!-- wp:paragraph -->');
    const lastParagraphClose = before.lastIndexOf('<!-- /wp:paragraph -->');
    // wp:shortcode の直前で開いている wp:paragraph があってはいけない
    expect(lastParagraphClose).toBeGreaterThan(lastParagraphOpen);
  });

  it('マーカーがない場合は通常の変換と同じ', () => {
    const md = 'こんにちは';
    const a = markdownToBlocks(md);
    const b = markdownToBlocks(md, { markerTransformers: [affilicardMarker] });
    expect(a).toBe(b);
  });
});
