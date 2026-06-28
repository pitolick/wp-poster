import matter from 'gray-matter';

export interface ParseFrontmatterResult {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * gray-matter（js-yaml）は YAML 1.1 の `!!timestamp` を有効にしているため、
 * 引用符なしの日付（`date: 2026-05-21` 等）を JS の Date オブジェクトに変換する。
 * その値は `validateFrontmatter` の文字列検証で弾かれ、本来正当なドラフトが投稿失敗する。
 * frontmatter 内の Date を ISO8601 文字列へ正規化して、この型不一致を防ぐ。
 */
function coerceDates(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(coerceDates);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = coerceDates(v);
    }
    return out;
  }
  return value;
}

/**
 * Markdown 文字列から YAML frontmatter と本文を分離する。
 * frontmatter が無い場合は frontmatter={} を返す。
 * YAML として壊れている場合は gray-matter が例外を投げる。
 */
export function parseFrontmatter(markdown: string): ParseFrontmatterResult {
  const parsed = matter(markdown);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  return {
    frontmatter: coerceDates(data) as Record<string, unknown>,
    content: parsed.content.trim(),
  };
}
