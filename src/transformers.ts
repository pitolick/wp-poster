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
 *
 * 検出パターン（優先度順）:
 *   A. `<!-- wp:paragraph --><p><strong>TOKEN</strong></p><!-- /wp:paragraph -->`
 *      → marked が `__TOKEN__` をボールド解釈し、markdown.ts が wp:paragraph で包んだ場合
 *   B. `<!-- wp:paragraph --><p>__TOKEN__</p><!-- /wp:paragraph -->`
 *      → marked がボールド解釈しなかったが wp:paragraph で包まれた場合
 *   C. `<p><strong>TOKEN</strong></p>` / `<p>__TOKEN__</p>`
 *      → wp:paragraph 外（テストやインラインケース）
 *   D. ベアトークン
 *      → 上記いずれにもマッチしないフォールバック
 *
 * パターン A/B でブロックコメントごと置換することで、Gutenberg の入れ子ブロック
 * （wp:paragraph の中に wp:embed 等を入れる構造）が出来てしまう不具合を防ぐ。
 */
export function restoreMarkers(html: string, placeholders: Placeholder[]): string {
  let out = html;
  for (const ph of placeholders) {
    const innerToken = ph.token.replace(/^__|__$/g, '');
    const tokenEsc = escapeRegex(ph.token);
    const innerEsc = escapeRegex(innerToken);

    // パターン A: wp:paragraph で包まれた <p><strong>TOKEN</strong></p>
    const blockBold = new RegExp(
      `<!-- wp:paragraph -->\\s*<p>\\s*<strong>${innerEsc}</strong>\\s*</p>\\s*<!-- /wp:paragraph -->`,
      'g',
    );
    const afterBlockBold = out.replace(blockBold, ph.block);
    if (afterBlockBold !== out) {
      out = afterBlockBold;
      continue;
    }

    // パターン B: wp:paragraph で包まれた <p>__TOKEN__</p>
    const blockPlain = new RegExp(
      `<!-- wp:paragraph -->\\s*<p>\\s*${tokenEsc}\\s*</p>\\s*<!-- /wp:paragraph -->`,
      'g',
    );
    const afterBlockPlain = out.replace(blockPlain, ph.block);
    if (afterBlockPlain !== out) {
      out = afterBlockPlain;
      continue;
    }

    // パターン C-1: 単独 <p><strong>TOKEN</strong></p>
    const inlineBold = new RegExp(`<p>\\s*<strong>${innerEsc}</strong>\\s*</p>`, 'g');
    const afterInlineBold = out.replace(inlineBold, ph.block);
    if (afterInlineBold !== out) {
      out = afterInlineBold;
      continue;
    }

    // パターン C-2: 単独 <p>__TOKEN__</p>
    const inlinePlain = new RegExp(`<p>\\s*${tokenEsc}\\s*</p>`, 'g');
    const afterInlinePlain = out.replace(inlinePlain, ph.block);
    if (afterInlinePlain !== out) {
      out = afterInlinePlain;
      continue;
    }

    // パターン D: ベアトークン
    out = out.split(ph.token).join(ph.block);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
