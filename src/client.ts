import type {
  WPPosterConfig,
  WPPostResponse,
  WPTerm,
  WPMedia,
  UploadMediaOptions,
} from './types.js';
import { WPRequestError } from './errors.js';

type FetchFn = typeof fetch;

/**
 * term 検索の 1 リクエストあたり件数。
 *
 * WP REST の既定は 10 件で、`search` は部分一致。「異世界」のようにありふれた語は
 * それを含む term 名（「異世界おじさん」「Re:ゼロから始める異世界生活」…）に埋もれて
 * 完全一致が結果に入らない。100 は WP REST の `per_page` 上限。
 */
const TERM_SEARCH_PER_PAGE = 100;

/**
 * WP が「その term は既にある」と 400 で返したときの、既存 term ID を取り出す。
 *
 * WP はこの場合 `{"code":"term_exists","data":{"status":400,"term_id":421}}` の形で
 * **既存 term の ID を本文に載せてくる**ので、作成失敗を回復できる。
 * 受け付けるのは `WPRequestError` かつ status 400 かつ `code === 'term_exists'` で、
 * `data.term_id` が数値のときだけ。形が違う／別のエラーなら `undefined` を返し、
 * 呼び出し元にそのまま投げ直させる（エラーを握り潰さない）。
 *
 * **パッケージの公開 API ではない**（`src/index.ts` は再エクスポートせず、
 * `package.json#exports` も `.` と `./draft` だけなので利用者からは到達できない）。
 * `export` しているのは単体テストから直接叩くためで、同ファイルの
 * `buildContentDisposition` と同じ扱い。したがって公開仕様（README.md /
 * `src/types.ts`）には載せず、仕様はこの TSDoc を正とする。
 */
export function termExistsId(err: unknown): number | undefined {
  if (!(err instanceof WPRequestError) || err.status !== 400) return undefined;
  const body = err.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const { code, data } = body as { code?: unknown; data?: unknown };
  if (code !== 'term_exists') return undefined;
  if (typeof data !== 'object' || data === null) return undefined;
  const termId = (data as { term_id?: unknown }).term_id;
  return typeof termId === 'number' ? termId : undefined;
}

export class WPClient {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly fetchFn: FetchFn;
  private readonly requestDelayMs: number;
  private readonly createMissingCategories: boolean;
  private readonly onMissingCategory?: (name: string) => void;

  constructor(config: WPPosterConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.auth =
      'Basic ' + Buffer.from(`${config.username}:${config.appPassword}`).toString('base64');
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.requestDelayMs = config.requestDelayMs ?? 0;
    this.createMissingCategories = config.createMissingCategories ?? true;
    this.onMissingCategory = config.onMissingCategory;
    if (typeof this.fetchFn !== 'function') {
      throw new Error('global fetch is not available; pass `fetch` in WPPosterConfig');
    }
  }

  /** ベース URL を付与した完全な URL を返す */
  resolve(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** multipart 等で使う任意 body の POST */
  async postRaw<T>(path: string, init: RequestInit): Promise<T> {
    return this.request<T>('POST', path, init);
  }

  async findBySlug(restBase: string, slug: string): Promise<{ id: number } | null> {
    const q = `slug=${encodeURIComponent(slug)}&status=any&per_page=1`;
    const found = await this.get<Array<{ id: number }>>(`/wp-json/wp/v2/${restBase}?${q}`);
    return found.length > 0 ? { id: found[0].id } : null;
  }

  async createAt(restBase: string, payload: Record<string, unknown>): Promise<WPPostResponse> {
    return this.postJson<WPPostResponse>(`/wp-json/wp/v2/${restBase}`, payload);
  }

  async updateAt(
    restBase: string,
    id: number,
    payload: Record<string, unknown>,
  ): Promise<WPPostResponse> {
    return this.postJson<WPPostResponse>(`/wp-json/wp/v2/${restBase}/${id}`, payload);
  }

  async createPost(payload: Record<string, unknown>): Promise<WPPostResponse> {
    return this.createAt('posts', payload);
  }

  async updatePost(id: number, payload: Record<string, unknown>): Promise<WPPostResponse> {
    return this.updateAt('posts', id, payload);
  }

  /**
   * 名前の完全一致で既存 term を探す。
   *
   * **`search=` だけでは足りない。** `search` は部分一致で、しかも既定 `per_page` は 10 件。
   * ありふれた語（例「異世界」）はそれを含む長い term 名に埋もれて、**完全一致が結果に現れない**。
   * 見つからないと呼び出し元は新規作成に回り、WP が 400 `term_exists` を返して投稿ごと落ちる。
   *
   * そこで 2 段で探す:
   *
   * 1. `search=`（`per_page` を上げる）— **カスタムスラッグの term もこれで拾える**
   *    （名前とスラッグが対応しない term は 2 の方法では引けないため、こちらを先に見る）
   * 2. `slug=` の完全一致 — WP が入力を term スラッグと同じ規則で正規化して照合するので、
   *    件数上限の影響を受けずに 1 件で引ける
   */
  private async findTermByName(
    endpoint: '/wp-json/wp/v2/tags' | '/wp-json/wp/v2/categories',
    name: string,
  ): Promise<WPTerm | undefined> {
    const q = encodeURIComponent(name);
    const searched = await this.get<WPTerm[]>(
      `${endpoint}?search=${q}&per_page=${TERM_SEARCH_PER_PAGE}`,
    );
    const exact = searched.find((t) => t.name === name);
    if (exact) return exact;
    const bySlug = await this.get<WPTerm[]>(`${endpoint}?slug=${q}&per_page=1`);
    return bySlug.find((t) => t.name === name);
  }

  private async resolveTermIds(
    endpoint: '/wp-json/wp/v2/tags' | '/wp-json/wp/v2/categories',
    names: string[],
  ): Promise<number[]> {
    const ids: number[] = [];
    const isCategory = endpoint.endsWith('/categories');
    for (const name of names) {
      const found = await this.findTermByName(endpoint, name);
      if (found) {
        ids.push(found.id);
        continue;
      }
      if (isCategory && !this.createMissingCategories) {
        this.onMissingCategory?.(name);
        continue;
      }
      try {
        const created = await this.postJson<WPTerm>(endpoint, { name });
        ids.push(created.id);
      } catch (err) {
        // 探索で見つからなくても、WP 側には**同じスラッグの term が既にある**ことがある
        // （名前が違うだけでスラッグが衝突する場合や、探索と作成の間に他プロセスが作った場合）。
        // WP はそのとき 400 で**既存の term ID を教えてくれる**ので、それを使う。
        // 作れないものを作ろうとして投稿ごと落とすより、WP が「これだ」と示した term に乗る。
        const existing = termExistsId(err);
        if (existing == null) throw err;
        ids.push(existing);
      }
    }
    return ids;
  }

  async resolveTagIds(names: string[]): Promise<number[]> {
    return this.resolveTermIds('/wp-json/wp/v2/tags', names);
  }

  async resolveCategoryIds(names: string[]): Promise<number[]> {
    return this.resolveTermIds('/wp-json/wp/v2/categories', names);
  }

  async uploadMedia(opts: UploadMediaOptions): Promise<WPMedia> {
    // WP REST API は Content-Disposition + 生バイナリ body での upload を受け付ける
    const media = await this.postRaw<WPMedia>('/wp-json/wp/v2/media', {
      headers: {
        'Content-Type': opts.mimeType,
        'Content-Disposition': buildContentDisposition(opts.filename),
      },
      body: opts.data,
    });

    // alt / caption / post の更新は別エンドポイント
    // （生バイナリ upload では JSON フィールドを同送できないため後続の JSON POST で設定する）
    // 空文字 alt/caption や post=0 も明示指定として送れるよう truthy ではなく undefined 判定にする
    if (opts.alt !== undefined || opts.caption !== undefined || opts.post !== undefined) {
      await this.postJson(`/wp-json/wp/v2/media/${media.id}`, {
        ...(opts.alt !== undefined ? { alt_text: opts.alt } : {}),
        ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
        ...(opts.post !== undefined ? { post: opts.post } : {}),
      });
    }
    return media;
  }

  private async request<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const url = this.resolve(path);
    const headers: Record<string, string> = {
      Authorization: this.auth,
      ...(init.headers as Record<string, string> | undefined),
    };

    const res = await this.fetchFn(url, { ...init, method, headers });
    const contentType = res.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await res.json() : await res.text();

    // ホスティング側スロットルへの対策として、レスポンス受信後に指定ミリ秒だけ待つ。
    // エラーパスでも次の呼出がすぐ走ると同じスロットルに引っかかるため、ok/!ok 双方で待つ。
    if (this.requestDelayMs > 0) {
      await delay(this.requestDelayMs);
    }

    if (!res.ok) {
      throw new WPRequestError(`${res.status} ${res.statusText}`, res.status, body);
    }
    return body as T;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Content-Disposition ヘッダ用にファイル名をサニタイズする。
 *
 * - 制御文字（CR/LF/TAB/DEL 等）を除去してヘッダインジェクションを防ぐ
 * - quoted-string 内に出現する `"` と `\` をエスケープして引用符を壊さない
 * - 非 ASCII を含む場合は RFC 6266 に従い `filename*=UTF-8''<encoded>` を併記
 *   （`filename=` には ASCII フォールバックとして `?` を残す）
 */
export function buildContentDisposition(filename: string): string {
  // 制御文字を除去（HTTP ヘッダインジェクション対策）。制御文字の除去が目的なのでルールを無効化する。
  // eslint-disable-next-line no-control-regex
  const noControl = filename.replace(/[\x00-\x1F\x7F]/g, '');
  const escaped = noControl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const hasNonAscii = /[^\x20-\x7E]/.test(noControl);
  if (hasNonAscii) {
    const asciiFallback = escaped.replace(/[^\x20-\x7E]/g, '?');
    const encoded = encodeURIComponent(noControl);
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
  }
  return `attachment; filename="${escaped}"`;
}
