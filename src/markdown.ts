import { marked } from 'marked';
import type { Tokens, Token } from 'marked';
import type { MarkerTransformer } from './types.js';
import { extractMarkers, restoreMarkers } from './transformers.js';
import { parseImageMarkdown, renderImageBlock } from './image-markdown.js';

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
      return wrapBlock('separator', '<hr class="wp-block-separator has-alpha-channel-opacity"/>');
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

/** core/heading の level 既定値。既定値は属性に書かないのが現行 WP の保存形。 */
const DEFAULT_HEADING_LEVEL = 2;

function renderHeading(t: Tokens.Heading): string {
  const inline = renderInlineText(t.text);
  const name = t.depth === DEFAULT_HEADING_LEVEL ? 'heading' : `heading {"level":${t.depth}}`;
  return wrapBlock(name, `<h${t.depth} class="wp-block-heading">${inline}</h${t.depth}>`);
}

function renderParagraph(t: Tokens.Paragraph): string {
  // 単独行の画像は core/image に変換する（`{id=… size=…}` の属性も含めて解析する）。
  // alt / src の属性値のエスケープは renderImageBlock が行う
  const image = parseImageMarkdown(t.raw);
  if (image) return renderImageBlock(image);
  // 画像の行の直後に空行を挟まず文章が続くと（`> ![…](…){id=…}` の次の行に `> 引用元：…` など）
  // 1 つの段落になる。画像の行を画像ブロックに、残りの行を段落に分ける。分けないと `{id=…}` が
  // 本文に文字として出てしまう
  const lines = t.text.split('\n');
  // 改行をまたぐインラインの要素（コード・リンク・強調など）が触れる行は画像として分けない。
  // それ以外の画像の行は分ける
  const inInline = linesInMultilineInline(t.text, t.tokens);
  const isImageLine = (l: string, i: number) => !inInline.has(i) && parseImageMarkdown(l) !== null;
  if (lines.length > 1 && lines.some(isImageLine)) {
    const blocks: string[] = [];
    let buf: string[] = [];
    const flush = () => {
      if (buf.length)
        blocks.push(wrapBlock('paragraph', `<p>${renderInlineText(buf.join('\n'))}</p>`));
      buf = [];
    };
    for (const [i, l] of lines.entries()) {
      const img = isImageLine(l, i) ? parseImageMarkdown(l) : null;
      if (img) {
        flush();
        blocks.push(renderImageBlock(img));
      } else {
        buf.push(l);
      }
    }
    flush();
    return blocks.join('\n\n');
  }
  // 参照形式（`![a][ref]`）など、上の記法に当たらない単独の画像も従来どおり core/image にする
  if (t.tokens && t.tokens.length === 1 && t.tokens[0].type === 'image') {
    const img = t.tokens[0] as Tokens.Image;
    return renderImageBlock({ alt: img.text ?? '', src: img.href });
  }
  const inline = renderInlineText(t.text);
  return wrapBlock('paragraph', `<p>${inline}</p>`);
}

/** 改行をまたいでも中身ごと 1 つの要素になるトークン（リンク・強調・インラインコードなど）。text と改行は除く */
function isMultilineInline(tk: Token): boolean {
  return tk.type !== 'text' && tk.type !== 'br' && tk.type !== 'escape' && tk.raw.includes('\n');
}

/**
 * 段落の本文のうち、改行をまたぐインラインの要素（インラインコード・リンク・強調・インラインの HTML
 * 要素など）が触れる行の番号を返す。これらの行を画像として分けると、コードの中身が画像ブロックに化けたり、リンクが壊れて記号が本文に
 * 残ったりする。インラインのトークンの raw を順につなぐと本文になるので、その位置から行を割り出す。
 * つながらない（位置を特定できない）ときは、安全側に倒して全行を返す。
 */
function linesInMultilineInline(text: string, tokens: Token[] | undefined): Set<number> {
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length - 1;
  const list = tokens ?? [];
  if (!list.some((tk) => isMultilineInline(tk) || tk.type === 'html')) return new Set();
  if (list.map((tk) => tk.raw).join('') !== text) return new Set(text.split('\n').map((_, i) => i));
  const lines = new Set<number>();
  const protect = (from: number, to: number) => {
    for (let i = lineOf(from); i <= lineOf(to); i++) lines.add(i);
  };
  // インラインの HTML は開始タグと終了タグが別々のトークンになるので、対応するタグの間を守る
  const openTags: Array<{ tag: string; start: number }> = [];
  let offset = 0;
  for (const tk of list) {
    const start = offset;
    offset += tk.raw.length;
    if (tk.type === 'html') {
      const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)\b[^>]*?(\/?)>$/.exec(tk.raw.trim());
      if (m) {
        const [, closing, name, selfClosing] = m;
        const tag = name.toLowerCase();
        if (closing) {
          const at = openTags.map((o) => o.tag).lastIndexOf(tag);
          if (at >= 0) {
            protect(openTags[at].start, offset);
            openTags.length = at;
          }
        } else if (!selfClosing && !VOID_ELEMENTS.has(tag)) {
          openTags.push({ tag, start });
        }
      }
    }
    if (isMultilineInline(tk)) protect(start, offset);
  }
  // 閉じられていないタグは段落の終わりまで続くものとして守る
  for (const o of openTags) protect(o.start, text.length);
  return lines;
}

/** 終了タグを持たない HTML 要素 */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

function renderList(t: Tokens.List): string {
  const tag = t.ordered ? 'ol' : 'ul';
  const blockName = t.ordered ? 'list {"ordered":true}' : 'list';
  const items = t.items
    .map((item) => wrapBlock('list-item', `<li>${renderInlineText(item.text)}</li>`))
    .join('\n\n');
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
