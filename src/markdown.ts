import { marked } from 'marked';
import type { Tokens, Token } from 'marked';
import type { MarkerTransformer } from './types.js';
import { extractMarkers, restoreMarkers } from './transformers.js';

export interface MarkdownOptions {
  markerTransformers?: MarkerTransformer[];
}

/**
 * Markdown 文字列を Gutenberg ブロック HTML に変換する。
 */
export function markdownToBlocks(markdown: string, options: MarkdownOptions = {}): string {
  const { text, placeholders } = extractMarkers(markdown, options.markerTransformers ?? []);
  const tokens = marked.lexer(text);
  const blocksHtml = tokens.map(renderToken).filter(Boolean).join('\n\n');
  return restoreMarkers(blocksHtml, placeholders);
}

function renderToken(token: Token): string {
  switch (token.type) {
    case 'heading':
      return renderHeading(token as Tokens.Heading);
    case 'paragraph':
      return renderParagraph(token as Tokens.Paragraph);
    case 'hr':
      return wrapBlock('separator', '<hr class="wp-block-separator"/>');
    case 'space':
      return '';
    default:
      // 未対応トークンは生 HTML として core/html ブロックに退避（後続タスクで上書き）
      return wrapBlock('html', marked.parser([token]).trim());
  }
}

function renderHeading(t: Tokens.Heading): string {
  const inline = renderInlineText(t.text);
  return wrapBlock(`heading {"level":${t.depth}}`, `<h${t.depth}>${inline}</h${t.depth}>`);
}

function renderParagraph(t: Tokens.Paragraph): string {
  const inline = renderInlineText(t.text);
  return wrapBlock('paragraph', `<p>${inline}</p>`);
}

function renderInlineText(raw: string): string {
  return marked.parseInline(raw) as string;
}

function wrapBlock(name: string, html: string): string {
  // 「heading {"level":1}」のように属性付きの場合と素の場合の両方を処理
  const closeName = name.split(' ')[0];
  return `<!-- wp:${name} -->\n${html}\n<!-- /wp:${closeName} -->`;
}
