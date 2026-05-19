import { describe, it, expect } from 'vitest';
import { extractMarkers, restoreMarkers, type MarkerTransformer } from '../src/transformers.js';

const affilicard: MarkerTransformer = {
  pattern: /\[affilicard id="(\d+)"\]/g,
  toBlock: (m) => `<!-- wp:shortcode -->\n[affilicard id="${m[1]}"]\n<!-- /wp:shortcode -->`,
};

describe('extractMarkers / restoreMarkers', () => {
  it('マッチ部分をプレースホルダに置換する', () => {
    const md = '前\n[affilicard id="42"]\n後';
    const { text, placeholders } = extractMarkers(md, [affilicard]);
    expect(text).not.toContain('[affilicard');
    expect(text).toMatch(/__WPP_MARKER_\d+__/);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].block).toContain('wp:shortcode');
  });

  it('プレースホルダを Gutenberg ブロックに戻す', () => {
    const md = '[affilicard id="42"]';
    const { text, placeholders } = extractMarkers(md, [affilicard]);
    const restored = restoreMarkers(`<p>${text}</p>`, placeholders);
    expect(restored).toContain('<!-- wp:shortcode -->');
    expect(restored).toContain('[affilicard id="42"]');
  });

  it('未マッチのテキストはそのまま', () => {
    const md = 'no markers here';
    const { text, placeholders } = extractMarkers(md, [affilicard]);
    expect(text).toBe('no markers here');
    expect(placeholders).toHaveLength(0);
  });

  it('複数マーカーを順序通り処理する', () => {
    const md = '[affilicard id="1"] x [affilicard id="2"]';
    const { text, placeholders } = extractMarkers(md, [affilicard]);
    expect(placeholders).toHaveLength(2);
    const restored = restoreMarkers(text, placeholders);
    expect(restored.indexOf('id="1"')).toBeLessThan(restored.indexOf('id="2"'));
  });
});
