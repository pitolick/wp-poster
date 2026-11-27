import { describe, it, expect, vi } from 'vitest';
import { WPClient } from '../src/client.js';
import { WPPosterError, WPRequestError } from '../src/errors.js';

/** URL ごとに応答（本文とヘッダ）を返す fetch。呼ばれた URL を記録する */
function makePagedFetch(
  pages: Record<string, { body: unknown; headers?: Record<string, string>; status?: number }>,
) {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const hit = pages[url];
    if (!hit) throw new Error(`unexpected url: ${url}`);
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { 'content-type': 'application/json', ...(hit.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fetchMock, urls };
}

function client(fetchMock: typeof fetch) {
  return new WPClient({
    url: 'https://example.com',
    username: 'u',
    appPassword: 'p',
    fetch: fetchMock,
  });
}

const B = 'https://example.com/wp-json/wp/v2/tags';

describe('WPClient.getPage', () => {
  it('本文と X-WP-Total / X-WP-TotalPages を返す', async () => {
    const { fetchMock } = makePagedFetch({
      [`${B}?per_page=2&page=1`]: {
        body: [{ id: 1 }, { id: 2 }],
        headers: { 'x-wp-total': '3', 'x-wp-totalpages': '2' },
      },
    });
    const page = await client(fetchMock).getPage('/wp-json/wp/v2/tags?per_page=2&page=1');
    expect(page).toEqual({ items: [{ id: 1 }, { id: 2 }], total: 3, totalPages: 2 });
  });

  it('ヘッダが無い・数でないときは null', async () => {
    const { fetchMock } = makePagedFetch({
      [`${B}?page=1`]: { body: [], headers: { 'x-wp-totalpages': 'abc' } },
    });
    const page = await client(fetchMock).getPage('/wp-json/wp/v2/tags?page=1');
    expect(page.total).toBeNull();
    expect(page.totalPages).toBeNull();
  });

  it('応答が配列でなければ WPPosterError', async () => {
    const { fetchMock } = makePagedFetch({ [`${B}`]: { body: { id: 1 } } });
    await expect(client(fetchMock).getPage('/wp-json/wp/v2/tags')).rejects.toBeInstanceOf(
      WPPosterError,
    );
  });

  it('HTTP エラーは WPRequestError のまま', async () => {
    const { fetchMock } = makePagedFetch({
      [`${B}`]: { body: { code: 'rest_forbidden' }, status: 403 },
    });
    await expect(client(fetchMock).getPage('/wp-json/wp/v2/tags')).rejects.toBeInstanceOf(
      WPRequestError,
    );
  });
});

describe('WPClient.getAll', () => {
  it('per_page が無ければ 100 を付けて、X-WP-TotalPages までたどる', async () => {
    const { fetchMock, urls } = makePagedFetch({
      [`${B}?_fields=id&per_page=100&page=1`]: {
        body: [{ id: 1 }],
        headers: { 'x-wp-totalpages': '2' },
      },
      [`${B}?_fields=id&per_page=100&page=2`]: {
        body: [{ id: 2 }],
        headers: { 'x-wp-totalpages': '2' },
      },
    });
    const all = await client(fetchMock).getAll<{ id: number }>('/wp-json/wp/v2/tags?_fields=id');
    expect(all).toEqual([{ id: 1 }, { id: 2 }]);
    expect(urls).toHaveLength(2);
  });

  it('権限で抜かれて途中のページが少なく（空でも）、総ページ数まではたどる', async () => {
    const { fetchMock } = makePagedFetch({
      [`${B}?per_page=2&page=1`]: { body: [{ id: 1 }], headers: { 'x-wp-totalpages': '3' } },
      [`${B}?per_page=2&page=2`]: { body: [], headers: { 'x-wp-totalpages': '3' } },
      [`${B}?per_page=2&page=3`]: { body: [{ id: 5 }], headers: { 'x-wp-totalpages': '3' } },
    });
    const all = await client(fetchMock).getAll('/wp-json/wp/v2/tags?per_page=2');
    expect(all).toEqual([{ id: 1 }, { id: 5 }]);
  });

  it('総ページ数が 0（該当なし）なら 1 ページで終える', async () => {
    const { fetchMock, urls } = makePagedFetch({
      [`${B}?per_page=100&page=1`]: {
        body: [],
        headers: { 'x-wp-total': '0', 'x-wp-totalpages': '0' },
      },
    });
    expect(await client(fetchMock).getAll('/wp-json/wp/v2/tags')).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it('ヘッダが無いときは per_page に満たないページで終える', async () => {
    const { fetchMock, urls } = makePagedFetch({
      [`${B}?per_page=2&page=1`]: { body: [{ id: 1 }, { id: 2 }] },
      [`${B}?per_page=2&page=2`]: { body: [{ id: 3 }] },
    });
    const all = await client(fetchMock).getAll('/wp-json/wp/v2/tags', { perPage: 2 });
    expect(all.map((t) => (t as { id: number }).id)).toEqual([1, 2, 3]);
    expect(urls).toHaveLength(2);
  });

  it('path の page は付け替える', async () => {
    const { fetchMock, urls } = makePagedFetch({
      [`${B}?page=1&per_page=100`]: { body: [{ id: 1 }], headers: { 'x-wp-totalpages': '1' } },
    });
    await client(fetchMock).getAll('/wp-json/wp/v2/tags?page=7');
    expect(urls).toEqual([`${B}?page=1&per_page=100`]);
  });

  it('maxPages を超えたら黙って打ち切らずに WPPosterError', async () => {
    const pages: Record<string, { body: unknown; headers?: Record<string, string> }> = {};
    for (let p = 1; p <= 3; p++)
      pages[`${B}?per_page=1&page=${p}`] = {
        body: [{ id: p }],
        headers: { 'x-wp-totalpages': '99' },
      };
    const { fetchMock } = makePagedFetch(pages);
    await expect(
      client(fetchMock).getAll('/wp-json/wp/v2/tags?per_page=1', { maxPages: 2 }),
    ).rejects.toThrow(/maxPages=2/);
  });

  it('ヘッダが無く件数が per_page で割り切れるとき、次のページの 400 rest_post_invalid_page_number で終える', async () => {
    const { fetchMock, urls } = makePagedFetch({
      [`${B}?per_page=2&page=1`]: { body: [{ id: 1 }, { id: 2 }] },
      [`${B}?per_page=2&page=2`]: { body: [{ id: 3 }, { id: 4 }] },
      [`${B}?per_page=2&page=3`]: {
        body: { code: 'rest_post_invalid_page_number', data: { status: 400 } },
        status: 400,
      },
    });
    const all = await client(fetchMock).getAll('/wp-json/wp/v2/tags', { perPage: 2 });
    expect(all.map((t) => (t as { id: number }).id)).toEqual([1, 2, 3, 4]);
    expect(urls).toHaveLength(3);
  });

  it('1 ページ目の 400 rest_post_invalid_page_number はそのまま投げる', async () => {
    const { fetchMock } = makePagedFetch({
      [`${B}?per_page=100&page=1`]: {
        body: { code: 'rest_post_invalid_page_number' },
        status: 400,
      },
    });
    await expect(client(fetchMock).getAll('/wp-json/wp/v2/tags')).rejects.toBeInstanceOf(
      WPRequestError,
    );
  });

  it('2 ページ目以降でも、ほかの 400 はそのまま投げる', async () => {
    const { fetchMock } = makePagedFetch({
      [`${B}?per_page=1&page=1`]: { body: [{ id: 1 }], headers: { 'x-wp-totalpages': '2' } },
      [`${B}?per_page=1&page=2`]: { body: { code: 'rest_invalid_param' }, status: 400 },
    });
    await expect(client(fetchMock).getAll('/wp-json/wp/v2/tags?per_page=1')).rejects.toBeInstanceOf(
      WPRequestError,
    );
  });

  it('path に offset があれば WPPosterError（WP は page より offset を優先する）', async () => {
    const { fetchMock, urls } = makePagedFetch({});
    await expect(
      client(fetchMock).getAll('/wp-json/wp/v2/posts?offset=0&per_page=2'),
    ).rejects.toThrow(/offset/);
    expect(urls).toHaveLength(0);
  });
});
