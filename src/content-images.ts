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
  /** この呼び出しで新たにアップロードしたメディア ID（投稿確定後に親を設定する対象） */
  uploadedMediaIds: number[];
}

interface MediaDetails {
  sizes?: Record<string, { source_url: string }>;
}

type MediaWithSizes = WPMedia & { media_details?: MediaDetails };

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
  const q = `search=${key}&per_page=20&_fields=id,source_url,media_type,media_details`;
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
 * `id` が既にある画像・コードブロックの中は触らない。
 */
export async function resolveContentImages(
  markdown: string,
  client: WPClient,
  options: ResolveContentImagesOptions = {},
): Promise<ResolveContentImagesResult> {
  const lines = markdown.split('\n');
  const images: ResolvedContentImage[] = [];
  const uploadedMediaIds: number[] = [];
  // 同じ画像が本文に 2 回出てきても 1 回だけ照合・アップロードする
  const cache = new Map<string, MediaWithSizes>();
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
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
        action = 'uploaded';
      }
      cache.set(key, media);
    }

    const picked = pickSize(media, wanted);
    const resolved: ContentImage = { ...image, id: media.id, src: picked.src, size: picked.size };
    lines[i] = line.replace(line.trim(), formatImageMarkdown(resolved));
    images.push({
      source: image.src,
      action,
      key,
      id: media.id,
      src: picked.src,
      size: picked.size,
    });
  }

  return { markdown: lines.join('\n'), images, uploadedMediaIds };
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
