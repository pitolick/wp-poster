import matter from 'gray-matter';

export interface ParseFrontmatterResult {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Markdown 文字列から YAML frontmatter と本文を分離する。
 * frontmatter が無い場合は frontmatter={} を返す。
 * YAML として壊れている場合は gray-matter が例外を投げる。
 */
export function parseFrontmatter(markdown: string): ParseFrontmatterResult {
  const parsed = matter(markdown);
  return {
    frontmatter: (parsed.data ?? {}) as Record<string, unknown>,
    content: parsed.content.trim(),
  };
}
