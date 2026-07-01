import { describe, it, expect, vi } from 'vitest';
import { downloadImage, uploadFeaturedImage } from '../src/images.js';
import { WPClient } from '../src/client.js';

describe('downloadImage', () => {
  it('URL から画像をダウンロードし mimeType / filename を返す', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    ) as unknown as typeof fetch;

    const img = await downloadImage('https://example.com/foo.png', { fetch: fetchMock });
    expect(img.mimeType).toBe('image/png');
    expect(img.filename).toBe('foo.png');
    expect(img.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(img.data)).toEqual([1, 2, 3]);
  });

  it('Content-Type ヘッダがない場合は拡張子から推定', async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as typeof fetch;
    const img = await downloadImage('https://example.com/x.jpg', { fetch: fetchMock });
    expect(img.mimeType).toBe('image/jpeg');
  });

  it('クエリストリング付きでもファイル名を抽出できる', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        }),
    ) as unknown as typeof fetch;
    const img = await downloadImage('https://example.com/path/cover.webp?foo=bar', {
      fetch: fetchMock,
    });
    expect(img.filename).toBe('cover.webp');
  });

  it('URL の最終セグメントが拡張子を持たない場合、Content-Type から拡張子を補完する', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    ) as unknown as typeof fetch;
    // placehold.co/600x400/png のように拡張子ではなく形式名がパス末尾にあるケース
    const img = await downloadImage('https://placehold.co/600x400/png', { fetch: fetchMock });
    expect(img.mimeType).toBe('image/png');
    expect(img.filename).toBe('png.png');
  });

  it('Content-Type もファイル名も拡張子情報なしの場合は .bin で代替する', async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([1]), { status: 200 }),
    ) as unknown as typeof fetch;
    const img = await downloadImage('https://example.com/asset', { fetch: fetchMock });
    expect(img.filename).toBe('asset.bin');
    expect(img.mimeType).toBe('application/octet-stream');
  });

  it('4xx はエラーになる', async () => {
    const fetchMock = vi.fn(
      async () => new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;
    await expect(downloadImage('https://example.com/x.png', { fetch: fetchMock })).rejects.toThrow(
      /404/,
    );
  });
});

describe('uploadFeaturedImage', () => {
  it('ダウンロード→アップロード→media id を返す', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET' });
      if (url === 'https://example.com/cover.jpg') {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      if (url.includes('/wp/v2/media')) {
        return new Response(
          JSON.stringify({ id: 555, source_url: 'https://wp/x.jpg', media_type: 'image' }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return new Response('not handled', { status: 500 });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://wp',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    const id = await uploadFeaturedImage(
      client,
      {
        source: 'https://example.com/cover.jpg',
        alt: 'カバー画像',
      },
      { fetch: fetchMock },
    );

    expect(id).toBe(555);
    expect(calls.some((c) => c.url === 'https://example.com/cover.jpg')).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/wp/v2/media'))).toBe(true);
  });

  it('data 指定時は DL せず直接 uploadMedia する', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, _init: RequestInit) => {
      calls.push(url);
      if (url.includes('/wp/v2/media')) {
        return new Response(
          JSON.stringify({ id: 777, source_url: 'https://wp/y.jpg', media_type: 'image' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not handled', { status: 500 });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://wp',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    const id = await uploadFeaturedImage(client, {
      data: new Uint8Array([9, 9, 9]),
      mimeType: 'image/jpeg',
      filename: 'thumb.jpg',
    });

    expect(id).toBe(777);
    // DL 用 GET は一切呼ばれない（media POST のみ）
    expect(calls.every((c) => c.includes('/wp/v2/media'))).toBe(true);
  });

  it('source も data も無ければ WPPosterError', async () => {
    const client = new WPClient({ url: 'https://wp', username: 'u', appPassword: 'p' });
    await expect(uploadFeaturedImage(client, { alt: 'x' })).rejects.toThrow(
      /source.*data|data.*source/,
    );
  });
});
