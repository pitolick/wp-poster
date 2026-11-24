import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WPClient } from './client.js';
import type { WPMedia } from './types.js';
import { downloadImage } from './images.js';
import {
  DEFAULT_IMAGE_SIZE,
  formatImageMarkdown,
  parseImageMarkdown,
  type ContentImage,
} from './image-markdown.js';

/** 鍵（ハッシュの先頭）の桁数。ファイル名に入れ、メディア検索に使う */
const KEY_LENGTH = 12;

export interface ResolveContentImagesOptions {
  /** 画像のダウンロードに使う fetch */
  fetch?: typeof fetch;
  /** `id` の無い画像に使う `sizeSlug`（画像側の `size` が優先）。既定 `large` */
  size?: string;
  /**
   * http(s) でない `src`（リポジトリ内のファイル）を読むときの基準ディレクトリ。
   * 未指定ならそのような画像は解決せず、そのまま残す（結果に `skipped` で記録）。
   */
  baseDir?: string;
}

export type ContentImageAction = 'reused' | 'uploaded' | 'skipped';

/** 1 枚ごとの判断。**必ず呼び出し側でログに出す**（無言でアップロードに倒れるとメディアが増えてから気づくことになる） */
export interface ResolvedContentImage {
  /** Markdown に書かれていた src */
  source: string;
  action: ContentImageAction;
  /** 照合に使った鍵（ファイル名に入る） */
  key?: string;
  id?: number;
  /** 出力に使う src（サイズ別の URL） */
  src?: string;
  size?: string;
  /** `skipped` の理由 */
  reason?: string;
}

export interface ResolveContentImagesResult {
  markdown: string;
  images: ResolvedContentImage[];
  /** この呼び出しで新たにアップロードしたメディア ID */
  uploadedMediaIds: number[];
  /**
   * 投稿確定後に親投稿を設定すべきメディア ID。新たにアップロードしたものに加え、再利用したが
   * 親が未設定（`post` が 0）のもの。前回の投稿で親の設定だけが失敗した画像を、再投稿で回復する。
   * 親が設定済みの再利用メディアは含めない（別の投稿の画像を付け替えない）
   */
  unattachedMediaIds: number[];
}

interface MediaDetails {
  sizes?: Record<string, { source_url: string }>;
}

type MediaWithSizes = WPMedia & { media_details?: MediaDetails; post?: number | null };

/**
 * 行頭の引用記号（`>`。入れ子・記号の前の空白 3 個まで）を外し、中身の字下げの桁数を返す。
 *
 * タブは 4 の倍数の桁まで進む。記号の直後のタブは 1 桁だけを記号の一部として消費し、残りの桁は
 * 中身の字下げに数える（CommonMark・marked と同じ）。例えば `>\t  x` は中身が 4 桁の字下げ＝コード。
 */
export function splitBlockquote(line: string): {
  prefix: string;
  content: string;
  /** 引用の深さ（0 は引用の外） */
  depth: number;
  /** 中身の先頭の字下げの桁数 */
  indent: number;
} {
  let i = 0;
  let col = 0;
  let depth = 0;
  let pending = 0; // 記号の直後のタブのうち、記号が消費しなかった桁数
  for (;;) {
    let j = i;
    let c = col;
    while (j - i < 3 && line[j] === ' ') {
      j++;
      c++;
    }
    if (line[j] !== '>') break;
    j++;
    c++;
    depth++;
    pending = 0;
    if (line[j] === ' ') {
      j++;
      c++;
    } else if (line[j] === '\t') {
      const width = 4 - (c % 4);
      j++;
      c += width;
      pending = width - 1;
    }
    i = j;
    col = c;
  }
  const content = line.slice(i);
  let indent = pending;
  let c = col;
  for (const ch of content) {
    if (ch === ' ') {
      indent++;
      c++;
    } else if (ch === '\t') {
      const width = 4 - (c % 4);
      indent += width;
      c += width;
    } else break;
  }
  return { prefix: line.slice(0, i), content, depth, indent };
}

function isRemote(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** WP のファイル名として安全な語幹にする（日本語・空白・記号は落とす） */
function safeStem(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  const cleaned = stem
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned || 'image';
}

function extOf(filename: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  return m ? m[1].toLowerCase() : 'bin';
}

/** 表示に使う URL と sizeSlug を決める。欲しいサイズが生成されていなければ原寸（full） */
function pickSize(media: MediaWithSizes, wanted: string): { src: string; size: string } {
  const sized = media.media_details?.sizes?.[wanted];
  if (sized?.source_url) return { src: sized.source_url, size: wanted };
  return { src: media.source_url, size: 'full' };
}

async function findMediaByKey(client: WPClient, key: string): Promise<MediaWithSizes | null> {
  // WP のメディア検索はタイトル・本文・抜粋が対象（ファイル名は対象外）。アップロード時に
  // 鍵入りのファイル名をタイトルにしているので、それで当てる
  const q = `search=${key}&per_page=20&_fields=id,source_url,media_type,media_details,post`;
  const found = await client.get<MediaWithSizes[]>(`/wp-json/wp/v2/media?${q}`);
  // 検索はタイトル等の部分一致なので、ファイルの URL に鍵が入っているものだけを同じ画像とみなす
  return found.find((m) => typeof m.source_url === 'string' && m.source_url.includes(key)) ?? null;
}

/**
 * 本文 Markdown のうち `id` の無い画像（単独行の `![alt](src)`）を、メディアライブラリの画像に解決する。
 *
 * 1. 鍵を決める: http(s) の src は URL の SHA-256、リポジトリ内のファイルは中身の SHA-256（先頭 12 桁）
 * 2. 鍵をファイル名に含むメディアがあれば再利用する（**何度投稿してもメディアは 1 枚のまま**）
 * 3. 無ければダウンロードして `<元の名前>-<鍵>.<拡張子>` でアップロードする
 * 4. 行を `id`・サイズ別の URL・`size` を埋めた形に書き換える
 *
 * `id` が既にある画像・コードブロックの中は触らない。引用（`> `）の中の画像は解決する。
 */
export async function resolveContentImages(
  markdown: string,
  client: WPClient,
  options: ResolveContentImagesOptions = {},
): Promise<ResolveContentImagesResult> {
  const lines = markdown.split('\n');
  const images: ResolvedContentImage[] = [];
  const uploadedMediaIds: number[] = [];
  const unattachedMediaIds: number[] = [];
  // 同じ画像が本文に 2 回出てきても 1 回だけ照合・アップロードする
  const cache = new Map<string, MediaWithSizes>();
  // 開いているコードフェンス（文字・長さ・開いた引用の深さ）。閉じるのは同じ文字で同じ長さ以上のフェンス。
  // 引用の中で開いたフェンスは、その引用が終わった時点でも閉じる（CommonMark と同じ）
  let fence: { char: string; length: number; depth: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    // 引用（`> `、入れ子の `> > ` も）の中の画像も解決する。記号を外した中身で判定し、書き戻すときに付け直す。
    // 作品ごとのポスターを「引用＋画像＋引用元」で見せる書き方（フィルムログの予習・復習記事）がこれに当たる
    const quote = splitBlockquote(lines[i]);
    const line = quote.content;

    if (fence) {
      if (fence.depth === 0) {
        // 引用の外で開いたフェンスの中では `> ` も中身の文字。閉じフェンスは元の行で判定する
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
        continue;
      }
      if (quote.depth < fence.depth) {
        // 引用が終わったので、引用の中で開いたフェンスも終わる。この行は通常どおり扱う
        fence = null;
      } else {
        // フェンスに使える字下げは 3 桁まで（引用記号の後のタブの残り幅も含めた実効の字下げで判定）
        const close = quote.indent <= 3 ? /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line) : null;
        if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
        continue;
      }
    }
    const open = quote.indent <= 3 ? /^[ \t]*(`{3,}|~{3,})/.exec(line) : null;
    if (open) {
      fence = { char: open[1][0], length: open[1].length, depth: quote.depth };
      continue;
    }
    // 4 桁以上の字下げはインデントのコードブロック。画像として扱わない（タブは 4 の倍数の桁まで進む）
    if (quote.indent >= 4) continue;
    const image = parseImageMarkdown(line);
    if (!image || image.id !== undefined) continue;

    const wanted = image.size ?? options.size ?? DEFAULT_IMAGE_SIZE;

    let key: string;
    let load: () => Promise<{ data: Uint8Array; filename: string; mimeType: string }>;
    if (isRemote(image.src)) {
      key = sha256Hex(image.src).slice(0, KEY_LENGTH);
      load = () => downloadImage(image.src, { fetch: options.fetch });
    } else if (options.baseDir) {
      const file = path.resolve(options.baseDir, image.src);
      const data = new Uint8Array(await readFile(file));
      key = sha256Hex(data).slice(0, KEY_LENGTH);
      const filename = path.basename(file);
      load = async () => ({ data, filename, mimeType: mimeFromExt(extOf(filename)) });
    } else {
      images.push({
        source: image.src,
        action: 'skipped',
        reason: 'http(s) でない src は baseDir を指定したときだけ解決します',
      });
      continue;
    }

    let media = cache.get(key) ?? null;
    let action: ContentImageAction = 'reused';
    if (!media) {
      media = await findMediaByKey(client, key);
      if (!media) {
        const loaded = await load();
        const filename = `${safeStem(loaded.filename)}-${key}.${extOf(loaded.filename)}`;
        media = (await client.uploadMedia({
          data: loaded.data,
          filename,
          mimeType: loaded.mimeType,
          // 検索はタイトルに当たる。画像に IPTC のタイトルが埋まっていると WP はそれをタイトルに
          // するため、鍵入りのファイル名を明示しないと次回見つからず毎回アップロードされる
          title: filename.replace(/\.[^.]+$/, ''),
          alt: image.alt,
        })) as MediaWithSizes;
        uploadedMediaIds.push(media.id);
        unattachedMediaIds.push(media.id);
        action = 'uploaded';
      } else if (!media.post) {
        unattachedMediaIds.push(media.id);
      }
      cache.set(key, media);
    }

    const picked = pickSize(media, wanted);
    const resolved: ContentImage = { ...image, id: media.id, src: picked.src, size: picked.size };
    // 置換文字列だと caption の `$&` などが置換記号として展開されるので、関数で渡す
    lines[i] = quote.prefix + line.replace(line.trim(), () => formatImageMarkdown(resolved));
    images.push({
      source: image.src,
      action,
      key,
      id: media.id,
      src: picked.src,
      size: picked.size,
    });
  }

  return { markdown: lines.join('\n'), images, uploadedMediaIds, unattachedMediaIds };
}

const MIME_FROM_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function mimeFromExt(ext: string): string {
  return MIME_FROM_EXT[ext] ?? 'application/octet-stream';
}
