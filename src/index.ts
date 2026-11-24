import { WPClient } from './client.js';
import { markdownToBlocks } from './markdown.js';
import { uploadFeaturedImage } from './images.js';
import { buildMetaPayload } from './meta.js';
import type { CacheBustHook } from './cache-bust.js';
import { noopCacheBust } from './cache-bust.js';
import type { PostInput, WPPosterConfig, WPPostResponse } from './types.js';
import { WPPosterError } from './errors.js';
import { sanitizeSlug } from './slug.js';

export const WP_POSTER_VERSION = '0.6.0';

export type {
  PostInput,
  PostMeta,
  ImageInput,
  MarkerTransformer,
  WPPosterConfig,
  WPPostResponse,
  WPTerm,
  WPMedia,
  UploadMediaOptions,
} from './types.js';
export { WPClient } from './client.js';
export { WPPosterError, WPRequestError } from './errors.js';
export { markdownToBlocks } from './markdown.js';
export { extractMarkers, restoreMarkers } from './transformers.js';
export { downloadImage, uploadFeaturedImage } from './images.js';
export type { CacheBustHook } from './cache-bust.js';
export { sanitizeSlug } from './slug.js';
export { normalizeTitleSeparators } from './title.js';

export interface PublishOptions {
  cacheBust?: CacheBustHook;
  /** featuredImage ダウンロード時に使う fetch（未指定なら設定の fetch） */
  fetch?: typeof fetch;
}

/** 既存投稿を更新するときに `status` を送るかどうか。 */
export type StatusOnUpdate = 'send' | 'omit';

export interface UpsertOptions extends PublishOptions {
  /**
   * slug が一致する既存投稿を**更新するとき**の `status` の扱い。新規作成には影響しない（常に送る）。
   *
   * - `'send'`（既定）: `input.status` をそのまま送る（従来どおり）
   * - `'omit'`: `input.status` を送らない。WP 上で公開済みの記事を、draft の `status: draft` で
   *   下書きに戻してしまう事故を防ぐ（公開状態は WP 管理画面で決める運用向け）
   */
  statusOnUpdate?: StatusOnUpdate;
}

const STATUS_ON_UPDATE_VALUES: readonly StatusOnUpdate[] = ['send', 'omit'];

export interface UpsertResult {
  id: number;
  created: boolean;
  link?: string;
}

export class WPPoster {
  private readonly client: WPClient;
  private readonly fetchFn: typeof fetch;

  constructor(config: WPPosterConfig) {
    this.client = new WPClient(config);
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  /** 新規投稿 */
  async publish(input: PostInput, options: PublishOptions = {}): Promise<WPPostResponse> {
    const payload = await this.buildPayload(input, options);
    const post = await this.client.createPost(payload);
    await this.attachFeaturedMedia(payload, post.id);
    await (options.cacheBust ?? noopCacheBust)(post);
    return post;
  }

  /** 既存投稿の更新 */
  async update(
    id: number,
    input: Partial<PostInput>,
    options: PublishOptions = {},
  ): Promise<WPPostResponse> {
    const payload = await this.buildPayload(input, options);
    const post = await this.client.updatePost(id, payload);
    await this.attachFeaturedMedia(payload, post.id);
    await (options.cacheBust ?? noopCacheBust)(post);
    return post;
  }

  /**
   * slug を自然キーに upsert する。slug 一致で update（slug は再送しない）、
   * 無ければ create。記事(`posts`)・CPT(`affilicard_product` 等)を共通で扱う。
   *
   * 更新時に `status` を送るかは `options.statusOnUpdate` で選ぶ（既定 `'send'`）。
   */
  async upsertBySlug(
    postType: string,
    input: PostInput,
    options: UpsertOptions = {},
  ): Promise<UpsertResult> {
    const statusOnUpdate = options.statusOnUpdate ?? 'send';
    // JS からの呼び出し（型検査が効かない）での綴り間違いを黙って 'send' 扱いにしない
    if (!STATUS_ON_UPDATE_VALUES.includes(statusOnUpdate)) {
      throw new WPPosterError(
        `upsertBySlug: statusOnUpdate must be 'send' or 'omit' (got ${JSON.stringify(statusOnUpdate)})`,
      );
    }
    if (!input.slug) {
      throw new WPPosterError('upsertBySlug requires input.slug');
    }
    const slug = sanitizeSlug(input.slug);
    if (!slug) {
      throw new WPPosterError('upsertBySlug requires a non-empty slug after normalization');
    }
    const existing = await this.client.findBySlug(postType, slug);
    const payload = await this.buildPayload({ ...input, slug }, options);

    let post: WPPostResponse;
    let created: boolean;
    if (existing) {
      delete payload.slug; // wp_unique_post_slug の `-2` 付与を誘発させない
      if (statusOnUpdate === 'omit') delete payload.status; // 公開状態は WP 側の値を保つ
      post = await this.client.updateAt(postType, existing.id, payload);
      created = false;
    } else {
      post = await this.client.createAt(postType, payload);
      created = true;
    }
    await this.attachFeaturedMedia(payload, post.id);
    await (options.cacheBust ?? noopCacheBust)(post);
    return { id: post.id, created, link: post.link };
  }

  /**
   * buildPayload でアップロードした featured メディアに親投稿を後追いで紐付ける。
   * アイキャッチはバイナリ upload の時点で投稿 ID が未確定のため、投稿確定後に
   * メディアの `post` を設定しないと親削除時に孤児メディアとして残ってしまう。
   */
  private async attachFeaturedMedia(
    payload: Record<string, unknown>,
    postId: number,
  ): Promise<void> {
    const mediaId = payload.featured_media;
    if (typeof mediaId === 'number' && mediaId > 0) {
      await this.client.updateAt('media', mediaId, { post: postId });
    }
  }

  private async buildPayload(
    input: Partial<PostInput>,
    options: PublishOptions,
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {};

    if (input.title !== undefined) payload.title = input.title;
    if (input.slug !== undefined) payload.slug = input.slug;
    if (input.status !== undefined) payload.status = input.status;
    if (input.date !== undefined) payload.date = input.date;
    if (input.excerpt !== undefined) payload.excerpt = input.excerpt;
    if (input.author !== undefined) payload.author = input.author;

    if (input.content !== undefined) {
      payload.content = markdownToBlocks(input.content, {
        markerTransformers: input.markerTransformers,
      });
    }

    if (input.tags?.length) {
      payload.tags = await this.client.resolveTagIds(input.tags);
    }
    if (input.categories?.length) {
      payload.categories = await this.client.resolveCategoryIds(input.categories);
    }

    if (input.featuredImage) {
      const mediaId = await uploadFeaturedImage(this.client, input.featuredImage, {
        fetch: options.fetch ?? this.fetchFn,
      });
      payload.featured_media = mediaId;
    } else if (input.featuredImage === null) {
      payload.featured_media = 0;
    }

    if (input.meta) {
      payload.meta = buildMetaPayload(input.meta);
    }

    return payload;
  }
}
