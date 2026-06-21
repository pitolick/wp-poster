import { describe, it, expect } from 'vitest';
import { buildMetaPayload } from '../src/meta.js';

describe('buildMetaPayload', () => {
  it('undefined を除外して REST が受け取れる形にする', () => {
    const out = buildMetaPayload({
      rank_math_title: 'タイトル',
      rank_math_description: undefined,
      custom: 'x',
    });
    expect(out).toEqual({
      rank_math_title: 'タイトル',
      custom: 'x',
    });
  });

  it('空オブジェクトは空オブジェクトを返す', () => {
    expect(buildMetaPayload({})).toEqual({});
  });

  it('boolean / number もそのまま含める', () => {
    const out = buildMetaPayload({ rank_math_focus_keyword: 'kw', _custom_flag: true, _count: 3 });
    expect(out).toEqual({ rank_math_focus_keyword: 'kw', _custom_flag: true, _count: 3 });
  });
});

describe('buildMetaPayload 配列メタ', () => {
  it('オブジェクト配列の meta 値をそのまま通す', () => {
    const listings = [{ platform: 'dmm-books', external_id: 'b950rshes00197', price: '100' }];
    const out = buildMetaPayload({ affilicard_listings: listings });
    expect(out.affilicard_listings).toEqual(listings);
  });

  it('undefined の値は除去する', () => {
    const out = buildMetaPayload({ a: 'x', b: undefined });
    expect(out).toEqual({ a: 'x' });
  });

  it('null の値は通す（undefined のみ除去）', () => {
    const out = buildMetaPayload({ a: null });
    expect(out).toEqual({ a: null });
  });
});
