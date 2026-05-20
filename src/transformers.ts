import type { MarkerTransformer } from './types.js';

export type { MarkerTransformer };

export interface Placeholder {
  /** Markdown 中に挿入される一意トークン */
  token: string;
  /** 最終出力時にトークンと置換する Gutenberg ブロック HTML */
  block: string;
}

// CommonMark の emphasis ルールでは「単語内の _ 」は強調にならないため、
// surrounding underscore なしのトークンにすることで marked が誤って <strong> 化するのを防ぐ
const TOKEN_PREFIX = 'WPP_MARKER_';
const TOKEN_SUFFIX = '_END';

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
 *
 * 検出パターン（優先度順）:
 *   A. `<!-- wp:paragraph --><p>TOKEN</p><!-- /wp:paragraph -->`
 *      → マーカーが独立段落として配置されたケース（推奨される使い方）
 *   B. `<p>TOKEN</p>`
 *      → wp:paragraph 外（直接 HTML に埋め込まれたケース・テスト用途）
 *   C. ベアトークン
 *      → 上記いずれにもマッチしないフォールバック（インラインケース等）
 *
 * パターン A でブロックコメントごと置換することで、Gutenberg の入れ子ブロック
 * （wp:paragraph の中に wp:embed 等を入れる構造）が出来てしまう不具合を防ぐ。
 *
 * 注意: マーカーは独立段落として配置することを推奨。インラインに埋め込んだ場合は
 * パターン C でベア置換されるため Gutenberg ブロックが `<p>...</p>` 内部に
 * 混入し「無効なコンテンツ」となる可能性がある。
 */
export function restoreMarkers(html: string, placeholders: Placeholder[]): string {
  let out = html;
  for (const ph of placeholders) {
    const tokenEsc = escapeRegex(ph.token);

    // パターン A: wp:paragraph で包まれた <p>TOKEN</p> をブロックごと置換
    const blockWrap = new RegExp(
      `<!-- wp:paragraph -->\\s*<p>\\s*${tokenEsc}\\s*</p>\\s*<!-- /wp:paragraph -->`,
      'g',
    );
    const afterBlock = out.replace(blockWrap, ph.block);
    if (afterBlock !== out) {
      out = afterBlock;
      continue;
    }

    // パターン B: 単独 <p>TOKEN</p>（wp:paragraph コメントなし）
    const paragraphOnly = new RegExp(`<p>\\s*${tokenEsc}\\s*</p>`, 'g');
    const afterParagraph = out.replace(paragraphOnly, ph.block);
    if (afterParagraph !== out) {
      out = afterParagraph;
      continue;
    }

    // パターン C: ベアトークン置換（インラインケースのフォールバック）
    out = out.split(ph.token).join(ph.block);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
