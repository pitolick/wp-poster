import type { PostInput } from '../types.js';
import type { DraftFrontmatter } from './schema.js';

/**
 * 検証済 frontmatter と本文を PostInput に詰め替える。
 * 未指定フィールドは PostInput に含めない（spread 形式）。
 */
export function adaptToPostInput(frontmatter: DraftFrontmatter, content: string): PostInput {
  const input: PostInput = {
    title: frontmatter.title,
    content,
  };
  if (frontmatter.slug !== undefined) input.slug = frontmatter.slug;
  if (frontmatter.status !== undefined) input.status = frontmatter.status;
  if (frontmatter.date !== undefined) input.date = frontmatter.date;
  if (frontmatter.excerpt !== undefined) input.excerpt = frontmatter.excerpt;
  if (frontmatter.author !== undefined) input.author = frontmatter.author;
  if (frontmatter.categories !== undefined) input.categories = frontmatter.categories;
  if (frontmatter.tags !== undefined) input.tags = frontmatter.tags;
  if (frontmatter.featuredImage !== undefined) input.featuredImage = frontmatter.featuredImage;
  if (frontmatter.meta !== undefined) input.meta = frontmatter.meta;
  return input;
}
