import type { ImageInput } from './types.js';
import type { WPClient } from './client.js';
import { WPPosterError } from './errors.js';

export interface DownloadedImage {
  data: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface DownloadOptions {
  fetch?: typeof fetch;
}

const MIME_FROM_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const EXT_FROM_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const KNOWN_IMAGE_EXTS = new Set(Object.keys(MIME_FROM_EXT));

export async function downloadImage(
  url: string,
  options: DownloadOptions = {},
): Promise<DownloadedImage> {
  const f = options.fetch ?? globalThis.fetch;
  const res = await f(url, { method: 'GET' });
  if (!res.ok) {
    throw new WPPosterError(`画像のダウンロードに失敗: ${res.status} ${res.statusText}`);
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  const rawName = extractFilename(url);
  const rawExt = rawName.includes('.') ? rawName.split('.').pop()!.toLowerCase() : '';
  // content-type は "image/jpeg; charset=utf-8" のようにパラメータを含む場合があるので分離する
  const contentType = res.headers.get('content-type')?.split(';')[0].trim();
  const mimeType = contentType || MIME_FROM_EXT[rawExt] || 'application/octet-stream';

  // ファイル名が拡張子なし、または画像拡張子として未認識の場合、
  // MIME タイプから拡張子を補完する（WordPress は filename の拡張子で MIME 判定するため）
  const filename = KNOWN_IMAGE_EXTS.has(rawExt)
    ? rawName
    : `${rawName}.${EXT_FROM_MIME[mimeType] ?? 'bin'}`;

  return { data: buffer, mimeType, filename };
}

function extractFilename(url: string): string {
  const noQuery = url.split('?')[0];
  const name = noQuery.split('/').pop();
  if (!name) throw new WPPosterError(`画像 URL からファイル名を抽出できません: ${url}`);
  return name;
}

export async function uploadFeaturedImage(
  client: WPClient,
  image: ImageInput,
  options: DownloadOptions = {},
): Promise<number> {
  let data: Uint8Array;
  let mimeType: string;
  let filename: string;

  if (image.data) {
    data = image.data;
    mimeType = image.mimeType ?? 'application/octet-stream';
    filename = image.filename ?? `upload.${EXT_FROM_MIME[mimeType] ?? 'bin'}`;
  } else if (image.source) {
    const downloaded = await downloadImage(image.source, options);
    data = downloaded.data;
    mimeType = downloaded.mimeType;
    filename = image.filename ?? downloaded.filename;
  } else {
    throw new WPPosterError('ImageInput には source か data のいずれかが必要です');
  }

  const media = await client.uploadMedia({
    data,
    filename,
    mimeType,
    alt: image.alt,
    caption: image.caption,
  });
  return media.id;
}
