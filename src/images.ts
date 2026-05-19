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

export async function downloadImage(url: string, options: DownloadOptions = {}): Promise<DownloadedImage> {
  const f = options.fetch ?? globalThis.fetch;
  const res = await f(url, { method: 'GET' });
  if (!res.ok) {
    throw new WPPosterError(`画像のダウンロードに失敗: ${res.status} ${res.statusText}`);
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  const filename = extractFilename(url);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  // content-type は "image/jpeg; charset=utf-8" のようにパラメータを含む場合があるので分離する
  const contentType = res.headers.get('content-type')?.split(';')[0].trim();
  const mimeType = contentType || MIME_FROM_EXT[ext] || 'application/octet-stream';

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
  const downloaded = await downloadImage(image.source, options);
  const filename = image.filename ?? downloaded.filename;
  const media = await client.uploadMedia({
    data: downloaded.data,
    filename,
    mimeType: downloaded.mimeType,
    alt: image.alt,
    caption: image.caption,
  });
  return media.id;
}
