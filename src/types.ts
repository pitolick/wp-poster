/** WP REST API への認証情報 */
export interface WPPosterConfig {
  /** WordPress のベース URL（末尾スラッシュなし）例: `https://example.com` */
  url: string;
  /** 投稿に使う WP ユーザー名 */
  username: string;
  /** Application Password（WP 管理画面で発行） */
  appPassword: string;
  /** テスト等から差し替えるための fetch 実装。未指定なら globalThis.fetch */
  fetch?: typeof fetch;
  /**
   * 連続する REST 呼出のスロットル回避用に、各 HTTP リクエスト後に挿入する遅延 (ミリ秒)。
   * `0` または未指定で無効。
   *
   * 短時間に大量の REST 呼出が走る運用 (タグ・カテゴリ解決 + 投稿 + メディアアップロード等)
   * では、ホスティング側 / セキュリティプラグインの「単一ユーザーからの大量アクセス」検知に
   * 引っかかり 503/メンテページが返ることがある。
   */
  requestDelayMs?: number;
  /**
   * カテゴリ解決時、検索で見つからないカテゴリ名を自動作成するかどうか。
   * デフォルト `true` (後方互換)。
   *
   * `false` のとき、未存在のカテゴリ名はスキップされ（投稿の `categories` には付かない）、
   * `onMissingCategory` が指定されていればその名前を渡して呼ばれる。
   *
   * Routine が新規カテゴリ名を frontmatter に書いてしまうのを安全側に倒したい運用
   * （カテゴリ階層を勝手に汚さない）で使う。タグ (`resolveTagIds`) には影響しない。
   */
  createMissingCategories?: boolean;
  /**
   * `createMissingCategories: false` のときに未存在カテゴリ名を呼出側に通知する callback。
   * wp-poster 内では console を呼ばないので、ロギングは呼出側が行う想定。
   */
  onMissingCategory?: (name: string) => void;
}

/** WPPoster.publish() / .update() に渡す投稿入力 */
export interface PostInput {
  title: string;
  /** Markdown 文字列 */
  content: string;
  /** WP の post_name（URL スラッグ）。未指定なら WP 側で title から自動生成 */
  slug?: string;
  status?: 'draft' | 'publish' | 'future' | 'pending' | 'private';
  /** ISO 8601。status='future' のときに使用 */
  date?: string;
  excerpt?: string;
  /** WP ユーザー ID */
  author?: number;
  /** カテゴリ名（存在しないものは新規作成） */
  categories?: string[];
  /** タグ名（存在しないものは新規作成） */
  tags?: string[];
  /** アイキャッチ画像 */
  featuredImage?: ImageInput | null;
  /** Rank Math 等のメタ */
  meta?: PostMeta;
  /** マーカートランスフォーマー（呼び出し側から差し込む） */
  markerTransformers?: MarkerTransformer[];
}

/** 画像入力 */
export interface ImageInput {
  /** 画像のソース URL（HTTPS） */
  source: string;
  /** WP 上のファイル名（拡張子込み）。未指定なら URL から推定 */
  filename?: string;
  alt?: string;
  caption?: string;
}

/** Rank Math 等の SEO メタ + 任意の post meta（配列/オブジェクトも可） */
export interface PostMeta {
  rank_math_title?: string;
  rank_math_description?: string;
  rank_math_focus_keyword?: string;
  /** その他任意の post meta（CPT の配列メタ等を含む） */
  [key: string]: unknown;
}

/** マーカートランスフォーマー: Markdown 内の特定パターンを Gutenberg ブロック HTML に置換 */
export interface MarkerTransformer {
  /** マッチさせる正規表現（必ず global フラグを使うこと） */
  pattern: RegExp;
  /** マッチに対して返す Gutenberg ブロック HTML 文字列 */
  toBlock: (match: RegExpMatchArray) => string;
}

/** publish/update のレスポンス（WP REST 投稿レスポンスの抜粋） */
export interface WPPostResponse {
  id: number;
  link: string;
  status: string;
  date: string;
  title: { rendered: string };
}

/** WP REST タグ/カテゴリのレスポンス */
export interface WPTerm {
  id: number;
  name: string;
  slug: string;
}

/** WP REST メディアのレスポンス */
export interface WPMedia {
  id: number;
  source_url: string;
  media_type: string;
}
