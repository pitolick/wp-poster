import type { PostMeta } from './types.js';

/**
 * WP REST API の `meta` フィールドに渡せる形に正規化する。
 * undefined の値を取り除く（REST は null を上書き、undefined を不正値として 400 を返すことがある）。
 */
export function buildMetaPayload(meta: PostMeta | undefined): Record<string, string | number | boolean> {
  if (!meta) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}
