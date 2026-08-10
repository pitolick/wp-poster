import { describe, it, expect, vi } from 'vitest';
import { WPClient, buildContentDisposition, termExistsId } from '../src/client.js';
import { WPRequestError } from '../src/errors.js';

function makeFetchOk<T>(body: T, init: ResponseInit = { status: 200 }): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
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
    expect(headers.Authorization).toBe(
      'Basic ' + Buffer.from('admin:pass word').toString('base64'),
    );
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

    const [, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ title: 'hi' }));
  });

  it('4xx は WPRequestError を投げる', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'bad' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
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

  it('requestDelayMs を指定すると各リクエスト後に setTimeout が呼ばれる', async () => {
    vi.useFakeTimers();
    const fetchMock = makeFetchOk({ ok: true });
    const client = new WPClient({
      url: 'https://example.com',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
      requestDelayMs: 500,
    });

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const promise = client.get('/wp-json/wp/v2/posts/1');
    // fetch のマイクロタスクを 1 回回してから setTimeout が積まれる
    await vi.advanceTimersByTimeAsync(0);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    await vi.runAllTimersAsync();
    await promise;
    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it('requestDelayMs 未指定なら setTimeout は呼ばれない', async () => {
    const fetchMock = makeFetchOk({ ok: true });
    const client = new WPClient({
      url: 'https://example.com',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await client.get('/wp-json/wp/v2/posts/1');
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
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
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 42,
            link: 'https://e/p',
            status: 'draft',
            date: '2026-05-19T00:00:00',
            title: { rendered: 'T' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });

    const res = await client.createPost({ title: 'T', content: '<p>x</p>', status: 'draft' });

    expect(res.id).toBe(42);
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0];
    expect(url).toBe('https://e/wp-json/wp/v2/posts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'T',
      content: '<p>x</p>',
      status: 'draft',
    });
  });

  it('updatePost は POST /wp/v2/posts/:id に payload を送る', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 42,
            link: 'l',
            status: 'publish',
            date: 'd',
            title: { rendered: 'T' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });

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
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/tags?search=bar') && init.method !== 'POST') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/tags') && init.method === 'POST') {
        return new Response(JSON.stringify({ id: 2, name: 'bar', slug: 'bar' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      // slug= での再照会（該当なし）。実 WP は 404 ではなく空配列を返す
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    const ids = await client.resolveTagIds(['foo', 'bar']);
    expect(ids).toEqual([1, 2]);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
  });

  it('resolveCategoryIds は /categories エンドポイントを使う', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/categories?search=manga')) {
        return new Response(JSON.stringify([{ id: 5, name: 'manga', slug: 'manga' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    const ids = await client.resolveCategoryIds(['manga']);
    expect(ids).toEqual([5]);
  });

  it('createMissingCategories: false で未存在カテゴリは作成せず skip し callback が呼ばれる', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET' });
      if (url.includes('/categories?search=manga')) {
        return new Response(JSON.stringify([{ id: 5, name: 'manga', slug: 'manga' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // 未存在カテゴリ "newcat" の検索は空配列
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const missing: string[] = [];
    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
      createMissingCategories: false,
      onMissingCategory: (name) => missing.push(name),
    });
    const ids = await client.resolveCategoryIds(['manga', 'newcat']);
    expect(ids).toEqual([5]); // newcat は skip され ID に含まれない
    expect(missing).toEqual(['newcat']);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(0); // POST /categories は走らない
  });

  it('createMissingCategories: false でも resolveTagIds は通常通り新規作成する', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET' });
      if (url.includes('/tags?search=bar') && init.method !== 'POST') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/tags') && init.method === 'POST') {
        return new Response(JSON.stringify({ id: 99, name: 'bar', slug: 'bar' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const missing: string[] = [];
    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
      createMissingCategories: false,
      onMissingCategory: (name) => missing.push(name),
    });
    const ids = await client.resolveTagIds(['bar']);
    expect(ids).toEqual([99]); // タグはちゃんと作成される
    expect(missing).toEqual([]); // onMissingCategory はタグでは呼ばれない
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
  });

  it('resolveTagIds: 完全一致のみ既存扱い（部分一致は新規作成）', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/tags?search=ai') && init.method !== 'POST') {
        return new Response(JSON.stringify([{ id: 10, name: 'AI Tools', slug: 'ai-tools' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/tags') && init.method === 'POST') {
        return new Response(JSON.stringify({ id: 11, name: 'ai', slug: 'ai' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    const ids = await client.resolveTagIds(['ai']);
    expect(ids).toEqual([11]);
  });

  it('resolveTagIds: search の件数上限に埋もれた完全一致は slug で拾う（新規作成しない）', async () => {
    // 実測（e-comi 本番・2026-08-10）: `search=異世界` は「異世界おじさん」等の部分一致で
    // 埋まり、完全一致の「異世界」が結果に現れない。slug 照会なら 1 件で引ける。
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      if (url.includes('search=')) {
        return new Response(
          JSON.stringify([
            { id: 795, name: '異世界おじさん', slug: 'x1' },
            { id: 805, name: '二度目の人生を異世界で', slug: 'x2' },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('slug=')) {
        return new Response(JSON.stringify([{ id: 421, name: '異世界', slug: 'isekai' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`想定外のリクエスト: ${init.method} ${url}`);
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    const ids = await client.resolveTagIds(['異世界']);

    expect(ids).toEqual([421]);
    // 作成に回らないこと（回ると WP が 400 term_exists を返して投稿ごと落ちる）
    expect(calls.filter((c) => c.startsWith('POST')).length).toBe(0);
  });

  it('resolveTagIds: search は per_page を上げて引く', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify([{ id: 3, name: 'foo', slug: 'foo' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    await client.resolveTagIds(['foo']);

    expect(calls[0]).toContain('per_page=100');
  });

  it('resolveTagIds: 作成が 400 term_exists なら本文の term_id を使う', async () => {
    // 探索で見つからなくてもスラッグが衝突していることがある（名前違い・競合作成）。
    // WP は既存 term の ID を教えてくれるので、投稿ごと落とさずそれに乗る。
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'term_exists',
            message: 'このタクソノミーにはすでに同じ名前とスラッグの項目があります。',
            data: { status: 400, term_id: 421 },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    await expect(client.resolveTagIds(['異世界'])).resolves.toEqual([421]);
  });

  it('resolveTagIds: term_exists 以外の 400 はそのまま投げる（黙って握らない）', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        return new Response(JSON.stringify({ code: 'rest_forbidden', data: { status: 400 } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    await expect(client.resolveTagIds(['foo'])).rejects.toThrow('400');
  });
});

describe('termExistsId', () => {
  it('term_exists の 400 から term_id を取り出す', () => {
    const err = new WPRequestError('400 Bad Request', 400, {
      code: 'term_exists',
      data: { status: 400, term_id: 421 },
    });
    expect(termExistsId(err)).toBe(421);
  });

  it('別のエラーコード・別の status・非エラーは undefined', () => {
    expect(
      termExistsId(new WPRequestError('400', 400, { code: 'rest_invalid_param' })),
    ).toBeUndefined();
    expect(
      termExistsId(new WPRequestError('409', 409, { code: 'term_exists', data: { term_id: 1 } })),
    ).toBeUndefined();
    expect(termExistsId(new Error('boom'))).toBeUndefined();
    expect(termExistsId(undefined)).toBeUndefined();
  });

  it('本文が文字列（非 JSON レスポンス）でも落ちない', () => {
    expect(termExistsId(new WPRequestError('400', 400, 'Bad Request'))).toBeUndefined();
  });

  it('term_id が数値でなければ採用しない', () => {
    const err = new WPRequestError('400', 400, { code: 'term_exists', data: { term_id: '421' } });
    expect(termExistsId(err)).toBeUndefined();
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
      return new Response(
        JSON.stringify({ id: 77, source_url: 'https://e/x.jpg', media_type: 'image' }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
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

  it('post を渡すと親投稿を後続の media 更新で設定する', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      });
      return new Response(
        JSON.stringify({ id: 77, source_url: 'https://e/x.jpg', media_type: 'image' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    await client.uploadMedia({
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
      post: 42,
    });

    // 1回目: 生バイナリ upload、2回目: /media/77 への JSON 更新で post を設定
    const update = calls.find((c) => c.url.endsWith('/wp/v2/media/77') && c.method === 'POST');
    expect(update).toBeDefined();
    expect((update!.body as { post: number }).post).toBe(42);
  });

  it('alt/caption/post いずれも無ければ追加の media 更新をしない', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET' });
      return new Response(
        JSON.stringify({ id: 77, source_url: 'https://e/x.jpg', media_type: 'image' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const client = new WPClient({
      url: 'https://e',
      username: 'u',
      appPassword: 'p',
      fetch: fetchMock,
    });
    await client.uploadMedia({
      data: new Uint8Array([0xff]),
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
    });

    // /media への POST は upload の1回のみ、/media/:id への更新は発生しない
    expect(calls.filter((c) => c.url.includes('/wp/v2/media')).length).toBe(1);
  });
});

describe('buildContentDisposition', () => {
  it('通常の ASCII ファイル名は quoted-string で返す', () => {
    expect(buildContentDisposition('cover.jpg')).toBe('attachment; filename="cover.jpg"');
  });

  it('ダブルクォートとバックスラッシュをエスケープする', () => {
    expect(buildContentDisposition('a"b\\c.png')).toBe('attachment; filename="a\\"b\\\\c.png"');
  });

  it('改行を含むファイル名はヘッダインジェクションを防ぐため除去する', () => {
    expect(buildContentDisposition('a\r\nInjected: x.png')).toBe(
      'attachment; filename="aInjected: x.png"',
    );
  });

  it('非 ASCII を含む場合は filename* に encodeURIComponent 結果を含める', () => {
    const result = buildContentDisposition('表紙.jpg');
    // 表紙 = 2 chars → ?? でフォールバック
    expect(result).toContain('filename="??.jpg"');
    expect(result).toContain("filename*=UTF-8''");
    expect(result).toContain(encodeURIComponent('表紙.jpg'));
  });
});

function clientWithFetch(fetchImpl: typeof fetch) {
  return new WPClient({
    url: 'https://wp.example',
    username: 'u',
    appPassword: 'p',
    fetch: fetchImpl,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WPClient rest_base 汎用化', () => {
  it('findBySlug は status=any 付きで検索し、最初の id を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 42 }]));
    const client = clientWithFetch(fetchMock as unknown as typeof fetch);

    const found = await client.findBySlug('affilicard_product', 'dmm-books-b950rshes00197');

    expect(found).toEqual({ id: 42 });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/wp-json/wp/v2/affilicard_product');
    expect(calledUrl).toContain('slug=dmm-books-b950rshes00197');
    expect(calledUrl).toContain('status=any');
    expect(calledUrl).toContain('per_page=1');
  });

  it('findBySlug は一致なしで null を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = clientWithFetch(fetchMock as unknown as typeof fetch);
    expect(await client.findBySlug('posts', 'no-such')).toBeNull();
  });

  it('createAt は rest_base 直下に POST する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 7, link: 'https://wp.example/?p=7' }));
    const client = clientWithFetch(fetchMock as unknown as typeof fetch);

    const res = await client.createAt('affilicard_product', { title: 'X' });

    expect(res.id).toBe(7);
    expect(fetchMock.mock.calls[0][0]).toBe('https://wp.example/wp-json/wp/v2/affilicard_product');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('updateAt は rest_base/{id} に POST する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 7 }));
    const client = clientWithFetch(fetchMock as unknown as typeof fetch);

    await client.updateAt('affilicard_product', 7, { title: 'Y' });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://wp.example/wp-json/wp/v2/affilicard_product/7',
    );
  });
});
