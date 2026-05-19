import { describe, it, expect, vi } from 'vitest';
import { WPClient } from '../src/client.js';
import { WPRequestError } from '../src/errors.js';

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
