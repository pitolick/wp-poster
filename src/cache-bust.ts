import type { WPPostResponse } from './types.js';

/**
 * 投稿後に呼ばれるキャッシュバストフック。
 * 現状は no-op。WP Super Cache 等を導入したら、ここで Purge API を叩く実装を差し込む。
 */
export type CacheBustHook = (post: WPPostResponse) => Promise<void> | void;

export const noopCacheBust: CacheBustHook = async () => {
  /* no-op */
};
