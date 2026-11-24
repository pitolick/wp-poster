import { WPPosterError } from './errors.js';

/**
 * 本文の画像 1 枚分。Markdown の 1 行と、`core/image` ブロック 1 個に対応する。
 *
 * Markdown では単独行で次のように書く（`{…}` は省略できる）:
 *
 * ```md
 * ![alt](src "キャプション"){id=712 size=large width=852px height=auto}
 * ```
 */
export interface ContentImage {
  alt: string;
  src: string;
  caption?: string;
  /** メディア ID。あると `class="wp-image-N"` が付き、ブロックエディタで正しい画像ブロックとして扱える */
  id?: number;
  /** `sizeSlug`（`large` / `full` など） */
  size?: string;
  /** 表示サイズ（Gutenberg の「サイズ変更」）。例 `852px` */
  width?: string;
  height?: string;
}

/** `id` があるときの `sizeSlug` 既定値。WP のブロックエディタが画像を挿入したときの既定と同じ */
export const DEFAULT_IMAGE_SIZE = 'large';

const RE_IMAGE_LINE =
  /^!\[((?:[^\]\\]|\\.)*)\]\(\s*([^\s()]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)(?:\{([^}]*)\})?\s*$/;
const RE_SIZE = /^[a-z0-9_-]+$/i;
const RE_DIMENSION = /^(?:auto|\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh)?)$/;

function unescapeMd(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

function escapeAlt(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function escapeCaption(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 1 行が画像の記法なら解析して返す。画像の行でなければ `null`。
 *
 * `{…}` の中に知らない属性や不正な値があれば例外を投げる。黙って無視すると、
 * 書き手の意図と違う画像ブロックが投稿されても気づけないため。
 */
export function parseImageMarkdown(line: string): ContentImage | null {
  const m = RE_IMAGE_LINE.exec(line.trim());
  if (!m) return null;
  const image: ContentImage = { alt: unescapeMd(m[1]), src: m[2] };
  if (m[3] !== undefined) image.caption = unescapeMd(m[3]);
  if (m[4] !== undefined) {
    for (const pair of m[4].trim().split(/\s+/).filter(Boolean)) {
      const eq = pair.indexOf('=');
      const key = eq > 0 ? pair.slice(0, eq) : pair;
      const value = eq > 0 ? pair.slice(eq + 1) : '';
      switch (key) {
        case 'id': {
          const id = Number(value);
          if (!/^\d+$/.test(value) || id <= 0) {
            throw new WPPosterError(`画像の id が不正です（正の整数）: ${line.trim()}`);
          }
          image.id = id;
          break;
        }
        case 'size':
          if (!RE_SIZE.test(value)) {
            throw new WPPosterError(`画像の size が不正です: ${line.trim()}`);
          }
          image.size = value;
          break;
        case 'width':
        case 'height':
          if (!RE_DIMENSION.test(value)) {
            throw new WPPosterError(`画像の ${key} が不正です（例 852px / auto）: ${line.trim()}`);
          }
          image[key] = value;
          break;
        default:
          throw new WPPosterError(
            `画像の属性 "${key}" は使えません（id / size / width / height）: ${line.trim()}`,
          );
      }
    }
  }
  return image;
}

/** `parseImageMarkdown` の逆。WP → Markdown の逆変換や、`id` を埋めた行の書き出しに使う */
export function formatImageMarkdown(image: ContentImage): string {
  const caption = image.caption !== undefined ? ` "${escapeCaption(image.caption)}"` : '';
  const attrs: string[] = [];
  if (image.id !== undefined) attrs.push(`id=${image.id}`);
  if (image.size !== undefined) attrs.push(`size=${image.size}`);
  if (image.width !== undefined) attrs.push(`width=${image.width}`);
  if (image.height !== undefined) attrs.push(`height=${image.height}`);
  const attrBlock = attrs.length ? `{${attrs.join(' ')}}` : '';
  return `![${escapeAlt(image.alt)}](${image.src}${caption})${attrBlock}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** テキストノード用。`"` は本文中ではエスケープ不要で、エディタも素のまま保存する */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * `core/image` ブロックを、ブロックエディタが保存するのと同じ形で出力する。
 *
 * 出力の形を WP の保存形に合わせないと、エディタで開いた瞬間に「無効なブロック」になるか、
 * 保存し直したときに別物として書き戻る。属性の並び（id → width → height → sizeSlug →
 * linkDestination）は core/image の block.json の定義順で、シリアライザがこの順に書く。
 *
 * - `id` / `size` / `width` / `height` のどれも無い画像は、従来どおり属性なしで出す
 * - `id` があれば `sizeSlug` は既定 `large`、`linkDestination` は `none`（エディタの挿入時の既定）
 */
export function renderImageBlock(image: ContentImage): string {
  const sizeSlug = image.size ?? (image.id !== undefined ? DEFAULT_IMAGE_SIZE : undefined);
  const hasAttrs =
    image.id !== undefined ||
    sizeSlug !== undefined ||
    image.width !== undefined ||
    image.height !== undefined;

  const attrs: Record<string, string | number> = {};
  if (image.id !== undefined) attrs.id = image.id;
  if (image.width !== undefined) attrs.width = image.width;
  if (image.height !== undefined) attrs.height = image.height;
  if (sizeSlug !== undefined) attrs.sizeSlug = sizeSlug;
  if (hasAttrs) attrs.linkDestination = 'none';

  const resized = image.width !== undefined || image.height !== undefined;
  const figureClass = [
    'wp-block-image',
    sizeSlug !== undefined ? `size-${sizeSlug}` : '',
    resized ? 'is-resized' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const style = [
    image.width !== undefined ? `width:${image.width}` : '',
    image.height !== undefined ? `height:${image.height}` : '',
  ]
    .filter(Boolean)
    .join(';');

  const img =
    `<img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}"` +
    (image.id !== undefined ? ` class="wp-image-${image.id}"` : '') +
    (style ? ` style="${style}"` : '') +
    '/>';
  const caption =
    image.caption !== undefined && image.caption !== ''
      ? `<figcaption class="wp-element-caption">${escapeText(image.caption)}</figcaption>`
      : '';

  const open = hasAttrs ? `<!-- wp:image ${JSON.stringify(attrs)} -->` : '<!-- wp:image -->';
  return `${open}\n<figure class="${figureClass}">${img}${caption}</figure>\n<!-- /wp:image -->`;
}
