import { describe, it, expect, vi } from 'vitest';
import { WPClient } from '../src/client.js';

function makeFetchOk<T>(body: T, init: ResponseInit = { status: 200 }): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: init.status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('WPClient', () => {
  it('Basic 認証ヘッダを付ける', async () => {
    const fetchMock = makeFetchOk({ id: 1 });
    const client = new WPClient({
      url: 'https://example.com',
      username: 'admin',
      appPassword: 'pass word',
      fetch: fetchMock,
    });

    await client.get('/wp-json/wp/v2/posts/1');

    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe('https://example.com/wp-json/wp/v2/posts/1');
    const headers = init.headers as Record<string, string>;
    // 'admin:pass word' を base64 化したもの
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('admin:pass word').toString('base64'));
    expect(headers['content-type']).toBeUndefined();
  });

  it('JSON POST は content-type を付ける', async () => {
    const fetchMock = makeFetchOk({ id: 99 });
    const client = new WPClient({
      url: 'https://example.com',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });

    await client.postJson('/wp-json/wp/v2/posts', { title: 'hi' });

    const [, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ title: 'hi' }));
  });

  it('4xx は WPRequestError を投げる', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 'bad' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    const client = new WPClient({
      url: 'https://example.com',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });

    await expect(client.get('/wp-json/wp/v2/posts/1')).rejects.toMatchObject({
      name: 'WPRequestError',
      status: 400,
      body: { code: 'bad' },
    });
  });

  it('URL の末尾スラッシュを正規化する', async () => {
    const fetchMock = makeFetchOk({ ok: true });
    const client = new WPClient({
      url: 'https://example.com/',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });

    await client.get('/wp-json/wp/v2/posts');
    const [url] = (fetchMock as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
  });
});

describe('WPClient.createPost / updatePost', () => {
  it('createPost は POST /wp/v2/posts に payload を送る', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ id: 42, link: 'https://e/p', status: 'draft', date: '2026-05-19T00:00:00', title: { rendered: 'T' } }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
    const client = new WPClient({ url: 'https://e', username: 'u', appPassword: 'p', fetch: fetchMock });

    const res = await client.createPost({ title: 'T', content: '<p>x</p>', status: 'draft' });

    expect(res.id).toBe(42);
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://e/wp-json/wp/v2/posts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'T', content: '<p>x</p>', status: 'draft' });
  });

  it('updatePost は POST /wp/v2/posts/:id に payload を送る', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ id: 42, link: 'l', status: 'publish', date: 'd', title: { rendered: 'T' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
    const client = new WPClient({ url: 'https://e', username: 'u', appPassword: 'p', fetch: fetchMock });

    await client.updatePost(42, { status: 'publish' });

    const [url] = (fetchMock as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(url).toBe('https://e/wp-json/wp/v2/posts/42');
  });
});

describe('WPClient タグ・カテゴリ解決', () => {
  it('resolveTagIds: 既存タグはそのまま、未存在は作成する', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      // 1: 検索「foo」→ 既存（id=1）
      // 2: 検索「bar」→ 該当なし
      // 3: POST 作成「bar」→ id=2
      if (url.includes('/tags?search=foo')) {
        return new Response(JSON.stringify([{ id: 1, name: 'foo', slug: 'foo' }]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/tags?search=bar') && init.method !== 'POST') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/tags') && init.method === 'POST') {
        return new Response(JSON.stringify({ id: 2, name: 'bar', slug: 'bar' }), {
          status: 201, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new WPClient({ url: 'https://e', username: 'u', appPassword: 'p', fetch: fetchMock });
    const ids = await client.resolveTagIds(['foo', 'bar']);
    expect(ids).toEqual([1, 2]);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
  });

  it('resolveCategoryIds は /categories エンドポイントを使う', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/categories?search=manga')) {
        return new Response(JSON.stringify([{ id: 5, name: 'manga', slug: 'manga' }]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new WPClient({ url: 'https://e', username: 'u', appPassword: 'p', fetch: fetchMock });
    const ids = await client.resolveCategoryIds(['manga']);
    expect(ids).toEqual([5]);
  });

  it('resolveTagIds: 完全一致のみ既存扱い（部分一致は新規作成）', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/tags?search=ai') && init.method !== 'POST') {
        return new Response(JSON.stringify([{ id: 10, name: 'AI Tools', slug: 'ai-tools' }]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/tags') && init.method === 'POST') {
        return new Response(JSON.stringify({ id: 11, name: 'ai', slug: 'ai' }), {
          status: 201, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new WPClient({ url: 'https://e', username: 'u', appPassword: 'p', fetch: fetchMock });
    const ids = await client.resolveTagIds(['ai']);
    expect(ids).toEqual([11]);
  });
});

describe('WPClient.uploadMedia', () => {
  it('multipart で /wp/v2/media に POST する', async () => {
    let receivedHeaders: Record<string, string> = {};
    let receivedBody: RequestInit['body'];
    let firstCall = true;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (firstCall) {
        receivedHeaders = init.headers as Record<string, string>;
        receivedBody = init.body;
        firstCall = false;
      }
      return new Response(JSON.stringify({ id: 77, source_url: 'https://e/x.jpg', media_type: 'image' }), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new WPClient({ url: 'https://e', username: 'u', appPassword: 'p', fetch: fetchMock });
    const data = new Uint8Array([0xff, 0xd8, 0xff]);
    const media = await client.uploadMedia({
      data,
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
      alt: 'alt text',
    });

    expect(media.id).toBe(77);
    expect(receivedHeaders['Content-Disposition']).toBe('attachment; filename="x.jpg"');
    expect(receivedHeaders['Content-Type']).toBe('image/jpeg');
    // 生のバイナリ body
    expect(receivedBody).toBeInstanceOf(Uint8Array);
  });
});
