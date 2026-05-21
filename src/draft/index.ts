import type { PostInput } from '../types.js';
import { parseFrontmatter } from './parser.js';
import { validateFrontmatter, type DraftFrontmatter } from './schema.js';
import { adaptToPostInput } from './adapter.js';

export interface ParseDraftResult {
  /** 検証成功時のみ非 null。失敗時は null。 */
  input: PostInput | null;
  errors: string[];
  warnings: string[];
}

/**
 * frontmatter 付き Markdown 文字列を解析・検証して PostInput に変換する。
 * 検証失敗時は input=null、errors に詳細を積む。
 */
export function parseDraft(markdown: string): ParseDraftResult {
  let frontmatter: Record<string, unknown>;
  let content: string;
  try {
    const parsed = parseFrontmatter(markdown);
    frontmatter = parsed.frontmatter;
    content = parsed.content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { input: null, errors: [`frontmatter parse error: ${msg}`], warnings: [] };
  }

  const { ok, errors, warnings } = validateFrontmatter(frontmatter);
  if (!ok) {
    return { input: null, errors, warnings };
  }

  const input = adaptToPostInput(frontmatter as unknown as DraftFrontmatter, content);
  return { input, errors: [], warnings };
}

/**
 * 検証のみ実行（CI で frontmatter の構造的妥当性を確認したい場合等に使用）。
 * adapter を呼ばないので軽量。
 */
export function validateDraft(markdown: string): { ok: boolean; errors: string[] } {
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(markdown).frontmatter;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`frontmatter parse error: ${msg}`] };
  }
  const { ok, errors } = validateFrontmatter(frontmatter);
  return { ok, errors };
}

// 再エクスポート（呼び出し側の利便性）
export type { DraftFrontmatter, DraftFeaturedImage, ValidationResult } from './schema.js';
