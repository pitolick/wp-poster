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
