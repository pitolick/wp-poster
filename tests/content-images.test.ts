import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WPClient } from '../src/client.js';
import { resolveContentImages } from '../src/content-images.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

const key = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex').slice(0, 12);

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** メディアライブラリを模したモック。アップロードされたメディアは検索で見つかるようになる */
function fakeWP(
  initial: Array<{ id: number; source_url: string; title: string; post?: number }> = [],
) {
  const media = [...initial];
  const calls: Call[] = [];
  let nextId = 100;
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = { url, method: init.method ?? 'GET', headers };
    if (typeof init.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);

    if (url.startsWith('https://cdn.example/')) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    const u = new URL(url);
    if (u.pathname === '/wp-json/wp/v2/media' && call.method === 'GET') {
      const q = u.searchParams.get('search') ?? '';
      // WP の検索はタイトルの部分一致
      const hits = media.filter((m) => m.title.includes(q));
      return jsonRes(
        hits.map((m) => ({
          id: m.id,
          source_url: m.source_url,
          media_type: 'image',
          post: m.post ?? 0,
          media_details: {
            sizes: { large: { source_url: m.source_url.replace('.jpg', '-724x1024.jpg') } },
          },
        })),
      );
    }
    if (u.pathname === '/wp-json/wp/v2/media' && call.method === 'POST') {
      const filename = /filename="([^"]+)"/.exec(headers['Content-Disposition'] ?? '')?.[1] ?? 'x';
      const m = {
        id: nextId++,
        source_url: `https://wp.example/wp-content/uploads/2026/11/${filename}`,
        // IPTC タイトル入りの画像を想定し、WP が付けるタイトルはファイル名と無関係にしておく
        title: 'IPTC title',
      };
      media.push(m);
      return jsonRes(
        {
          id: m.id,
          source_url: m.source_url,
          media_type: 'image',
          media_details: {
            sizes: { large: { source_url: m.source_url.replace('.jpg', '-724x1024.jpg') } },
          },
        },
        201,
      );
    }
    const update = /^\/wp-json\/wp\/v2\/media\/(\d+)$/.exec(u.pathname);
    if (update && call.method === 'POST') {
      const m = media.find((x) => x.id === Number(update[1]))!;
      const b = call.body as { title?: string };
      if (b.title !== undefined) m.title = b.title;
      return jsonRes({ id: m.id, source_url: m.source_url, media_type: 'image' });
    }
    return jsonRes({}, 404);
  }) as unknown as typeof fetch;
  const client = new WPClient({
    url: 'https://wp.example',
    username: 'u',
    appPassword: 'p',
    fetch: f,
  });
  return { client, calls, media, fetch: f };
}

const SRC = 'https://cdn.example/posters/alien.jpg';

describe('resolveContentImages', () => {
  it('無ければアップロードし、id・large の URL・size を埋めた行に書き換える', async () => {
    const wp = fakeWP();
    const md = `## エイリアン\n\n![エイリアン](${SRC} "公式ポスター")\n\n本文`;
    const res = await resolveContentImages(md, wp.client, { fetch: wp.fetch });

    const k = key(SRC);
    expect(res.markdown).toBe(
      `## エイリアン\n\n![エイリアン](https://wp.example/wp-content/uploads/2026/11/alien-${k}-724x1024.jpg "公式ポスター"){id=100 size=large}\n\n本文`,
    );
    expect(res.images).toEqual([
      expect.objectContaining({ source: SRC, action: 'uploaded', key: k, id: 100, size: 'large' }),
    ]);
    expect(res.uploadedMediaIds).toEqual([100]);
    // 鍵入りのファイル名でアップロードし、タイトルにも鍵入りの名前を明示する
    const upload = wp.calls.find((c) => c.method === 'POST' && c.url.endsWith('/wp/v2/media'))!;
    expect(upload.headers['Content-Disposition']).toContain(`alien-${k}.jpg`);
    const meta = wp.calls.find((c) => c.method === 'POST' && c.url.endsWith('/wp/v2/media/100'))!;
    expect(meta.body).toEqual({ title: `alien-${k}`, alt_text: 'エイリアン' });
  });

  it('2 回目は同じメディアを再利用し、アップロードしない（冪等）', async () => {
    const wp = fakeWP();
    const md = `![エイリアン](${SRC})`;
    const first = await resolveContentImages(md, wp.client, { fetch: wp.fetch });
    const uploadsAfterFirst = wp.calls.filter((c) => c.method === 'POST').length;

    const second = await resolveContentImages(md, wp.client, { fetch: wp.fetch });
    expect(second.markdown).toBe(first.markdown);
    expect(second.images[0].action).toBe('reused');
    expect(second.uploadedMediaIds).toEqual([]);
    expect(wp.calls.filter((c) => c.method === 'POST').length).toBe(uploadsAfterFirst);
    expect(wp.media).toHaveLength(1);
  });

  it('検索に部分一致しても、URL に鍵が無いメディアは同じ画像とみなさない', async () => {
    const k = key(SRC);
    const wp = fakeWP([{ id: 7, source_url: 'https://wp.example/other.jpg', title: `note ${k}` }]);
    const res = await resolveContentImages(`![a](${SRC})`, wp.client, { fetch: wp.fetch });
    expect(res.images[0].action).toBe('uploaded');
  });

  it('同じ画像が本文に 2 回出ても照合・アップロードは 1 回', async () => {
    const wp = fakeWP();
    const res = await resolveContentImages(`![a](${SRC})\n\n![b](${SRC})`, wp.client, {
      fetch: wp.fetch,
    });
    expect(res.uploadedMediaIds).toEqual([100]);
    expect(wp.calls.filter((c) => c.url.startsWith('https://cdn.example/'))).toHaveLength(1);
    expect(res.markdown.split('\n\n').every((l) => l.includes('{id=100 size=large}'))).toBe(true);
  });

  it('欲しいサイズが生成されていなければ原寸（full）にする', async () => {
    const wp = fakeWP();
    const res = await resolveContentImages(`![a](${SRC}){size=medium}`, wp.client, {
      fetch: wp.fetch,
    });
    expect(res.markdown).toMatch(/\{id=100 size=full\}$/);
    expect(res.markdown).toContain(`alien-${key(SRC)}.jpg`);
  });

  it('id のある画像・コードブロックの中・文中の画像は触らない', async () => {
    const wp = fakeWP();
    const md = [
      '![a](https://wp.example/x.jpg){id=5 size=large}',
      '```md',
      `![b](${SRC})`,
      '```',
      `文中の ![c](${SRC}) 画像`,
    ].join('\n');
    const res = await resolveContentImages(md, wp.client, { fetch: wp.fetch });
    expect(res.markdown).toBe(md);
    expect(res.images).toEqual([]);
    expect(wp.calls).toEqual([]);
  });

  it('リポジトリ内のファイルは中身のハッシュを鍵にする（baseDir 指定時）', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wpp-'));
    const data = new Uint8Array([9, 9, 9]);
    writeFileSync(path.join(dir, 'diagram.png'), data);
    const wp = fakeWP();
    const res = await resolveContentImages('![図](images/../diagram.png)', wp.client, {
      fetch: wp.fetch,
      baseDir: dir,
    });
    expect(res.images[0]).toEqual(expect.objectContaining({ action: 'uploaded', key: key(data) }));
    const upload = wp.calls.find((c) => c.method === 'POST' && c.url.endsWith('/wp/v2/media'))!;
    expect(upload.headers['Content-Type']).toBe('image/png');
    expect(upload.headers['Content-Disposition']).toContain(`diagram-${key(data)}.png`);
  });

  it('baseDir が無ければ http(s) でない画像は見送って理由を残す', async () => {
    const wp = fakeWP();
    const res = await resolveContentImages('![図](images/diagram.png)', wp.client, {
      fetch: wp.fetch,
    });
    expect(res.markdown).toBe('![図](images/diagram.png)');
    expect(res.images[0]).toEqual(expect.objectContaining({ action: 'skipped' }));
    expect(res.images[0].reason).toBeTruthy();
  });

  it('日本語などファイル名に使えない文字は落とす', async () => {
    const wp = fakeWP();
    const src = 'https://cdn.example/%E3%83%9D%E3%82%B9%E3%82%BF%E3%83%BC.jpg';
    const res = await resolveContentImages(`![a](${src})`, wp.client, { fetch: wp.fetch });
    const upload = wp.calls.find((c) => c.method === 'POST' && c.url.endsWith('/wp/v2/media'))!;
    expect(upload.headers['Content-Disposition']).toContain(`E3-83-9D`);
    expect(res.images[0].action).toBe('uploaded');
  });
});

describe('resolveContentImages: コード・置換記号・親の未設定（レビュー指摘）', () => {
  it('4 個のバッククォートのフェンスの中にある ``` では閉じない', async () => {
    const wp = fakeWP();
    const md = ['````md', '```', `![a](${SRC})`, '```', '````'].join('\n');
    const res = await resolveContentImages(md, wp.client, { fetch: wp.fetch });
    expect(res.markdown).toBe(md);
    expect(wp.calls).toEqual([]);
  });

  it('バッククォートのフェンスの中の ~~~ では閉じない', async () => {
    const wp = fakeWP();
    const md = ['```', '~~~', `![a](${SRC})`, '```'].join('\n');
    const res = await resolveContentImages(md, wp.client, { fetch: wp.fetch });
    expect(res.markdown).toBe(md);
  });

  it('フェンスが閉じた後の画像は解決する', async () => {
    const wp = fakeWP();
    const res = await resolveContentImages(
      ['~~~', 'code', '~~~~', '', `![a](${SRC})`].join('\n'),
      wp.client,
      {
        fetch: wp.fetch,
      },
    );
    expect(res.images.map((i) => i.action)).toEqual(['uploaded']);
  });

  it('4 文字以上の字下げ（インデントのコードブロック）は画像として扱わない', async () => {
    const wp = fakeWP();
    const md = `例:\n\n    ![a](${SRC})\n\t![b](${SRC})\n  \t![c](${SRC})\n   \t![d](${SRC})`;
    const res = await resolveContentImages(md, wp.client, { fetch: wp.fetch });
    expect(res.markdown).toBe(md);
    expect(wp.calls).toEqual([]);
  });

  it('キャプションの $& などを置換記号として展開しない', async () => {
    const wp = fakeWP();
    const res = await resolveContentImages(`![a](${SRC} "価格 $& と $' と $\`")`, wp.client, {
      fetch: wp.fetch,
    });
    expect(res.markdown).toContain(`"価格 $& と $' と $\`"){id=100 size=large}`);
  });

  it('再利用したメディアの親が未設定なら、親を設定する対象に入れる（前回の失敗を回復）', async () => {
    const k = key(SRC);
    const wp = fakeWP([
      { id: 7, source_url: `https://wp.example/u/alien-${k}.jpg`, title: `alien-${k}`, post: 0 },
    ]);
    const res = await resolveContentImages(`![a](${SRC})`, wp.client, { fetch: wp.fetch });
    expect(res.images[0].action).toBe('reused');
    expect(res.uploadedMediaIds).toEqual([]);
    expect(res.unattachedMediaIds).toEqual([7]);
  });

  it('再利用したメディアに親が付いていれば付け替えない', async () => {
    const k = key(SRC);
    const wp = fakeWP([
      { id: 7, source_url: `https://wp.example/u/alien-${k}.jpg`, title: `alien-${k}`, post: 42 },
    ]);
    const res = await resolveContentImages(`![a](${SRC})`, wp.client, { fetch: wp.fetch });
    expect(res.unattachedMediaIds).toEqual([]);
  });

  it('新たにアップロードしたメディアは親を設定する対象に入る', async () => {
    const wp = fakeWP();
    const res = await resolveContentImages(`![a](${SRC})`, wp.client, { fetch: wp.fetch });
    expect(res.unattachedMediaIds).toEqual([100]);
  });
});
