const KNOWN_KEYS = new Set([
  'title',
  'slug',
  'status',
  'date',
  'excerpt',
  'author',
  'categories',
  'tags',
  'featuredImage',
  'meta',
  'source',
]);

const STATUSES = new Set(['draft', 'publish', 'future', 'pending', 'private']);

export interface DraftFeaturedImage {
  source: string;
  filename?: string;
  alt?: string;
  caption?: string;
}

export interface DraftFrontmatter {
  title: string;
  slug?: string;
  status?: 'draft' | 'publish' | 'future' | 'pending' | 'private';
  date?: string;
  excerpt?: string;
  author?: number;
  categories?: string[];
  tags?: string[];
  featuredImage?: DraftFeaturedImage | null;
  meta?: Record<string, string | number | boolean>;
  /**
   * orchestrator がドラフト生成元を追跡するためのトレースメタ。
   * wp-poster は値を解釈せず、WP REST API にも送信しない（adapter で除外）。
   * 例: `source: { generator: 'claude-routine', skill: 'e-comi-sale-check' }`
   */
  source?: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateFrontmatter(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['frontmatter must be a YAML object'], warnings };
  }
  const obj = input as Record<string, unknown>;

  // title (required)
  if (typeof obj.title !== 'string' || obj.title.length === 0) {
    errors.push('title is required and must be a non-empty string');
  }

  // optional string fields
  for (const key of ['slug', 'date', 'excerpt'] as const) {
    if (obj[key] !== undefined && typeof obj[key] !== 'string') {
      errors.push(`${key} must be a string if specified`);
    }
  }

  // status
  if (obj.status !== undefined) {
    if (typeof obj.status !== 'string' || !STATUSES.has(obj.status)) {
      errors.push(
        `status must be one of: ${Array.from(STATUSES).join(', ')} (got ${JSON.stringify(obj.status)})`,
      );
    }
  }

  // author
  if (obj.author !== undefined && typeof obj.author !== 'number') {
    errors.push('author must be a number if specified');
  }

  // categories / tags
  for (const key of ['categories', 'tags'] as const) {
    if (obj[key] !== undefined) {
      const v = obj[key];
      if (!Array.isArray(v) || !v.every((item) => typeof item === 'string')) {
        errors.push(`${key} must be an array of strings if specified`);
      }
    }
  }

  // featuredImage
  if (obj.featuredImage !== undefined && obj.featuredImage !== null) {
    const fi = obj.featuredImage;
    if (typeof fi !== 'object' || fi === null || Array.isArray(fi)) {
      errors.push('featuredImage must be an object, null, or omitted');
    } else {
      const fiObj = fi as Record<string, unknown>;
      if (typeof fiObj.source !== 'string' || fiObj.source.length === 0) {
        errors.push('featuredImage.source is required and must be a non-empty string');
      }
      for (const k of ['filename', 'alt', 'caption'] as const) {
        if (fiObj[k] !== undefined && typeof fiObj[k] !== 'string') {
          errors.push(`featuredImage.${k} must be a string if specified`);
        }
      }
    }
  }

  // source (orchestrator 用トレースメタ、wp-poster は解釈しない)
  if (obj.source !== undefined) {
    if (typeof obj.source !== 'object' || obj.source === null || Array.isArray(obj.source)) {
      errors.push('source must be an object if specified');
    }
  }

  // meta
  if (obj.meta !== undefined) {
    if (typeof obj.meta !== 'object' || obj.meta === null || Array.isArray(obj.meta)) {
      errors.push('meta must be an object if specified');
    } else {
      const metaObj = obj.meta as Record<string, unknown>;
      for (const [k, v] of Object.entries(metaObj)) {
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
          errors.push(`meta.${k} must be string | number | boolean`);
        }
      }
    }
  }

  // Unknown top-level keys → warnings
  for (const k of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(k)) {
      warnings.push(`unknown frontmatter key: ${k}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
