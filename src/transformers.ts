import type { MarkerTransformer } from './types.js';

export type { MarkerTransformer };

export interface Placeholder {
  /** Markdown 中に挿入される一意トークン */
  token: string;
  /** 最終出力時にトークンと置換する Gutenberg ブロック HTML */
  block: string;
}

const TOKEN_PREFIX = '__WPP_MARKER_';
const TOKEN_SUFFIX = '__';

/**
 * Markdown テキストからマーカーを抽出し、プレースホルダトークンに置換する。
 * 戻り値の text を marked に渡し、生成された HTML に対して restoreMarkers を適用する。
 */
export function extractMarkers(
  markdown: string,
  transformers: MarkerTransformer[],
): { text: string; placeholders: Placeholder[] } {
  const placeholders: Placeholder[] = [];
  let text = markdown;

  for (const tr of transformers) {
    // global 必須。利用側が忘れた場合に備えて作り直す
    const re = tr.pattern.flags.includes('g')
      ? new RegExp(tr.pattern.source, tr.pattern.flags)
      : new RegExp(tr.pattern.source, tr.pattern.flags + 'g');

    text = text.replace(re, (...args: unknown[]) => {
      // String.prototype.replace は (match, ...groups, offset, string[, groups?]) を渡す。
      // 名前付きキャプチャがあるとき末尾に groups オブジェクトが追加されるので検出して除外する
      const last = args[args.length - 1];
      const hasGroupsObj = typeof last === 'object' && last !== null;
      const tailCount = hasGroupsObj ? 3 : 2;
      const match = args.slice(0, args.length - tailCount) as unknown as RegExpMatchArray;
      const block = tr.toBlock(match);
      const token = `${TOKEN_PREFIX}${placeholders.length}${TOKEN_SUFFIX}`;
      placeholders.push({ token, block });
      return token;
    });
  }

  return { text, placeholders };
}

/**
 * marked が生成した HTML 中のプレースホルダを Gutenberg ブロックに戻す。
 * marked は `<p>__WPP_MARKER_0__</p>` のようにパラグラフで包むことがあるので、
 * 包んでいるタグごと取り除く。
 * また `__TOKEN__` は marked が `<strong>TOKEN</strong>` にレンダリングする場合があるため、
 * `<p><strong>WPP_MARKER_N</strong></p>` 形式も検出して取り除く。
 */
export function restoreMarkers(html: string, placeholders: Placeholder[]): string {
  let out = html;
  for (const ph of placeholders) {
    // パターン 1: <p>__WPP_MARKER_N__</p>（そのままプレースホルダが段落に包まれた場合）
    // test() ではなく replace() の戻り値と元文字列を比較することで RegExp.lastIndex 状態を意識せずに済ませる
    const wrappedPlain = new RegExp(`<p>\\s*${escapeRegex(ph.token)}\\s*</p>`, 'g');
    const afterPlain = out.replace(wrappedPlain, ph.block);
    if (afterPlain !== out) {
      out = afterPlain;
      continue;
    }
    // パターン 2: <p><strong>WPP_MARKER_N</strong></p>
    // marked が __ をボールド記法として解釈した場合
    const innerToken = ph.token.replace(/^__|__$/g, '');
    const wrappedBold = new RegExp(
      `<p>\\s*<strong>${escapeRegex(innerToken)}</strong>\\s*</p>`,
      'g',
    );
    const afterBold = out.replace(wrappedBold, ph.block);
    if (afterBold !== out) {
      out = afterBold;
      continue;
    }
    out = out.split(ph.token).join(ph.block);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
