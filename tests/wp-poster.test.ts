import { describe, it, expect, vi } from 'vitest';
import { WPPoster } from '../src/index.js';
import type { MarkerTransformer } from '../src/types.js';

interface RecordedCall {
  url: string;
  method: string;
  body?: unknown;
}

function makeRecordingFetch(responder: (call: RecordedCall) => Response): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    const call: RecordedCall = {
      url,
      method: init.method ?? 'GET',
      body: init.body ? tryParse(init.body) : undefined,
    };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

function tryParse(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WPPoster.publish', () => {
  it('最小ケース: タイトル + 本文 → POST /wp/v2/posts', async () => {
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: 'https://e/p/1', status: 'draft', date: 'd', title: { rendered: 'T' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    const res = await poster.publish({ title: 'T', content: 'Hello' });

    expect(res.id).toBe(1);
    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts') && c.method === 'POST');
    expect(post).toBeDefined();
    expect((post!.body as { title: string }).title).toBe('T');
    expect((post!.body as { content: string }).content).toContain('<!-- wp:paragraph -->');
    expect((post!.body as { content: string }).content).toContain('<p>Hello</p>');
  });

  it('タグ・カテゴリは ID に解決される', async () => {
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url.includes('/tags?search=manga'))
        return jsonRes([{ id: 7, name: 'manga', slug: 'manga' }]);
      if (c.url.includes('/categories?search=blog'))
        return jsonRes([{ id: 3, name: 'blog', slug: 'blog' }]);
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: '', status: 'draft', date: 'd', title: { rendered: '' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    await poster.publish({ title: 't', content: 'c', tags: ['manga'], categories: ['blog'] });

    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts') && c.method === 'POST');
    expect((post!.body as { tags: number[] }).tags).toEqual([7]);
    expect((post!.body as { categories: number[] }).categories).toEqual([3]);
  });

  it('featuredImage が undefined のときは featured_media を payload に含めない', async () => {
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: '', status: 'draft', date: 'd', title: { rendered: '' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    // featuredImage を指定しない（undefined）
    await poster.publish({ title: 't', content: 'c' });

    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts') && c.method === 'POST');
    // メディアアップロードは発生しない
    expect(calls.some((c) => c.url.includes('/wp/v2/media'))).toBe(false);
    // payload にも featured_media フィールドは存在しない
    expect(post!.body as Record<string, unknown>).not.toHaveProperty('featured_media');
  });

  it('featuredImage を null にするとアイキャッチ解除（featured_media: 0）になる', async () => {
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: '', status: 'draft', date: 'd', title: { rendered: '' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    await poster.publish({ title: 't', content: 'c', featuredImage: null });

    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts') && c.method === 'POST');
    // メディアアップロードは発生しない
    expect(calls.some((c) => c.url.includes('/wp/v2/media'))).toBe(false);
    // featured_media: 0 が設定される
    expect((post!.body as { featured_media: number }).featured_media).toBe(0);
  });

  it('featuredImage は media アップロード後に featured_media を設定', async () => {
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url === 'https://cdn/x.jpg')
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      if (c.url.includes('/wp/v2/media') && c.method === 'POST') {
        return jsonRes({ id: 99, source_url: 'https://e/x.jpg', media_type: 'image' }, 201);
      }
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: '', status: 'draft', date: 'd', title: { rendered: '' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    await poster.publish({
      title: 't',
      content: 'c',
      featuredImage: { source: 'https://cdn/x.jpg', alt: 'a' },
    });

    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts') && c.method === 'POST');
    expect((post!.body as { featured_media: number }).featured_media).toBe(99);
  });

  it('markerTransformers を Markdown 変換に反映する', async () => {
    const marker: MarkerTransformer = {
      pattern: /\[affilicard id="(\d+)"\]/g,
      toBlock: (m) => `<!-- wp:shortcode -->\n[affilicard id="${m[1]}"]\n<!-- /wp:shortcode -->`,
    };
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: '', status: 'draft', date: 'd', title: { rendered: '' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    await poster.publish({
      title: 't',
      content: '前\n\n[affilicard id="42"]\n\n後',
      markerTransformers: [marker],
    });

    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts') && c.method === 'POST');
    const body = post!.body as { content: string };
    expect(body.content).toContain('<!-- wp:shortcode -->');
    expect(body.content).toContain('[affilicard id="42"]');
  });

  it('meta は buildMetaPayload を通して付与される', async () => {
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: '', status: 'draft', date: 'd', title: { rendered: '' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    await poster.publish({
      title: 't',
      content: 'c',
      meta: { rank_math_title: 'SEO', rank_math_description: undefined },
    });

    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts') && c.method === 'POST');
    expect((post!.body as { meta: Record<string, unknown> }).meta).toEqual({
      rank_math_title: 'SEO',
    });
  });

  it('cacheBust フックが投稿後に呼ばれる', async () => {
    const { fetch: f } = makeRecordingFetch((c) => {
      if (c.url.endsWith('/wp/v2/posts') && c.method === 'POST') {
        return jsonRes(
          { id: 1, link: 'https://e/p/1', status: 'publish', date: 'd', title: { rendered: 'T' } },
          201,
        );
      }
      return jsonRes({}, 404);
    });
    const hook = vi.fn();
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    await poster.publish({ title: 'T', content: 'c' }, { cacheBust: hook });

    expect(hook).toHaveBeenCalledTimes(1);
    expect((hook.mock.calls[0][0] as { id: number }).id).toBe(1);
  });
});

describe('WPPoster.update', () => {
  it('既存投稿に対して POST /wp/v2/posts/:id を発行', async () => {
    const { fetch: f, calls } = makeRecordingFetch((c) => {
      if (c.url.endsWith('/wp/v2/posts/42') && c.method === 'POST') {
        return jsonRes(
          { id: 42, link: '', status: 'publish', date: 'd', title: { rendered: 'T' } },
          200,
        );
      }
      return jsonRes({}, 404);
    });
    const poster = new WPPoster({ url: 'https://e', username: 'u', appPassword: 'p', fetch: f });

    await poster.update(42, { status: 'publish' });

    const post = calls.find((c) => c.url.endsWith('/wp/v2/posts/42') && c.method === 'POST');
    expect(post).toBeDefined();
    expect((post!.body as { status: string }).status).toBe('publish');
  });
});

describe('WPPoster.upsertBySlug', () => {
  const base = { url: 'https://wp.example', username: 'u', appPassword: 'p' };

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('slug 不一致なら create する（created=true）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([])) // findBySlug → なし
      .mockResolvedValueOnce(jsonResponse({ id: 11, link: 'https://wp.example/?p=11' })); // createAt
    const poster = new WPPoster({ ...base, fetch: fetchMock as unknown as typeof fetch });

    const res = await poster.upsertBySlug('affilicard_product', {
      title: '来世ではちゃんとします 1巻',
      content: '',
      slug: 'dmm-books-b950rshes00197',
      status: 'publish',
      meta: { affilicard_listings: [{ platform: 'dmm-books', external_id: 'b950rshes00197' }] },
    });

    expect(res).toEqual({ id: 11, created: true, link: 'https://wp.example/?p=11' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://wp.example/wp-json/wp/v2/affilicard_product');
  });

  it('slug 一致なら id 指定 update し、payload に slug を含めない（created=false）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 99 }])) // findBySlug → あり
      .mockResolvedValueOnce(jsonResponse({ id: 99, link: 'https://wp.example/?p=99' })); // updateAt
    const poster = new WPPoster({ ...base, fetch: fetchMock as unknown as typeof fetch });

    const res = await poster.upsertBySlug('affilicard_product', {
      title: 'X',
      content: '',
      slug: 'dmm-books-b950rshes00197',
      status: 'publish',
    });

    expect(res.created).toBe(false);
    expect(res.id).toBe(99);
    expect(res.link).toBe('https://wp.example/?p=99');
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://wp.example/wp-json/wp/v2/affilicard_product/99',
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(sentBody.slug).toBeUndefined(); // 更新時は slug を再送しない
  });

  it('slug 未指定はエラー', async () => {
    const poster = new WPPoster({ ...base, fetch: vi.fn() as unknown as typeof fetch });
    await expect(poster.upsertBySlug('posts', { title: 'X', content: '' })).rejects.toThrow(/slug/);
  });

  it('非正規化 slug でも正規化後の slug で検索し update 経路を取る', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 77 }])) // findBySlug → あり
      .mockResolvedValueOnce(jsonResponse({ id: 77, link: 'https://wp.example/?p=77' }));
    const poster = new WPPoster({ ...base, fetch: fetchMock as unknown as typeof fetch });

    const res = await poster.upsertBySlug('posts', {
      title: 'X',
      content: '',
      slug: 'Foo / Bar',
      status: 'draft',
    });

    expect(res.created).toBe(false);
    expect(res.id).toBe(77);
    const findUrl = fetchMock.mock.calls[0][0] as string;
    expect(findUrl).toContain('slug=foo-bar'); // 正規化後の slug で検索している
  });
});
