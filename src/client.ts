import type { WPPosterConfig, WPPostResponse, WPTerm, WPMedia } from './types.js';
import { WPRequestError } from './errors.js';

type FetchFn = typeof fetch;

export class WPClient {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly fetchFn: FetchFn;
  private readonly requestDelayMs: number;
  private readonly createMissingCategories: boolean;
  private readonly onMissingCategory?: (name: string) => void;

  constructor(config: WPPosterConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.auth = 'Basic ' + Buffer.from(`${config.username}:${config.appPassword}`).toString('base64');
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

  async createPost(payload: Record<string, unknown>): Promise<WPPostResponse> {
    return this.postJson<WPPostResponse>('/wp-json/wp/v2/posts', payload);
  }

  async updatePost(id: number, payload: Record<string, unknown>): Promise<WPPostResponse> {
    return this.postJson<WPPostResponse>(`/wp-json/wp/v2/posts/${id}`, payload);
  }

  private async resolveTermIds(
    endpoint: '/wp-json/wp/v2/tags' | '/wp-json/wp/v2/categories',
    names: string[],
  ): Promise<number[]> {
    const ids: number[] = [];
    const isCategory = endpoint.endsWith('/categories');
    for (const name of names) {
      const search = encodeURIComponent(name);
      const found = await this.get<WPTerm[]>(`${endpoint}?search=${search}`);
      const exact = found.find((t) => t.name === name);
      if (exact) {
        ids.push(exact.id);
        continue;
      }
      if (isCategory && !this.createMissingCategories) {
        this.onMissingCategory?.(name);
        continue;
      }
      const created = await this.postJson<WPTerm>(endpoint, { name });
      ids.push(created.id);
    }
    return ids;
  }

  async resolveTagIds(names: string[]): Promise<number[]> {
    return this.resolveTermIds('/wp-json/wp/v2/tags', names);
  }

  async resolveCategoryIds(names: string[]): Promise<number[]> {
    return this.resolveTermIds('/wp-json/wp/v2/categories', names);
  }

  async uploadMedia(opts: {
    data: Uint8Array;
    filename: string;
    mimeType: string;
    alt?: string;
    caption?: string;
  }): Promise<WPMedia> {
    // WP REST API は Content-Disposition + 生バイナリ body での upload を受け付ける
    const media = await this.postRaw<WPMedia>('/wp-json/wp/v2/media', {
      headers: {
        'Content-Type': opts.mimeType,
        'Content-Disposition': buildContentDisposition(opts.filename),
      },
      body: opts.data,
    });

    // alt / caption の更新は別エンドポイント
    if (opts.alt || opts.caption) {
      await this.postJson(`/wp-json/wp/v2/media/${media.id}`, {
        ...(opts.alt !== undefined ? { alt_text: opts.alt } : {}),
        ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
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
  // 制御文字を除去（HTTP ヘッダインジェクション対策）
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
