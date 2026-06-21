import type { PostMeta } from './types.js';

/**
 * WP REST API の `meta` フィールドに渡せる形に正規化する。
 * undefined の値を取り除く（REST は undefined を不正値として 400 を返すことがある）。
 * 配列・オブジェクト値はそのまま通す（CPT の配列メタ対応）。
 */
export function buildMetaPayload(meta: PostMeta | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
