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
    case 'list':
      return renderList(token as Tokens.List);
    case 'blockquote':
      return renderBlockquote(token as Tokens.Blockquote);
    case 'code':
      return renderCode(token as Tokens.Code);
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
  // 単独の画像トークンだけの段落は core/image に変換
  if (t.tokens && t.tokens.length === 1 && t.tokens[0].type === 'image') {
    const img = t.tokens[0] as Tokens.Image;
    // href / alt は属性値なので必ずエスケープする（alt に " や < を含む日本語ドラフトで
    // 属性が破断し Gutenberg がブロックを無効化するのを防ぐ）。
    return wrapBlock(
      'image',
      `<figure class="wp-block-image"><img src="${escapeHtml(img.href)}" alt="${escapeHtml(img.text ?? '')}"/></figure>`,
    );
  }
  const inline = renderInlineText(t.text);
  return wrapBlock('paragraph', `<p>${inline}</p>`);
}

function renderList(t: Tokens.List): string {
  const tag = t.ordered ? 'ol' : 'ul';
  const blockName = t.ordered ? 'list {"ordered":true}' : 'list';
  const items = t.items
    .map((item) => `<li>${renderInlineText(item.text)}</li>`)
    .join('');
  return wrapBlock(blockName, `<${tag} class="wp-block-list">${items}</${tag}>`);
}

function renderBlockquote(t: Tokens.Blockquote): string {
  const inner = (t.tokens ?? []).map(renderToken).filter(Boolean).join('');
  return wrapBlock('quote', `<blockquote class="wp-block-quote">${inner}</blockquote>`);
}

function renderCode(t: Tokens.Code): string {
  const text = escapeHtml(t.text);
  return wrapBlock('code', `<pre class="wp-block-code"><code>${text}</code></pre>`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineText(raw: string): string {
  return marked.parseInline(raw) as string;
}

function wrapBlock(name: string, html: string): string {
  // 「heading {"level":1}」のように属性付きの場合と素の場合の両方を処理
  const closeName = name.split(' ')[0];
  return `<!-- wp:${name} -->\n${html}\n<!-- /wp:${closeName} -->`;
}
