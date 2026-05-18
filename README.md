# wp-poster

WordPress 投稿機構の汎用 TypeScript ライブラリ。`filmlog-ai`・`ai-article-poster` など複数プロジェクトから submodule として利用される。

## 責務

- WordPress REST API クライアント（Application Password 認証）
- Markdown → Gutenberg ブロック変換
- 画像ダウンロード・リサイズ・アップロード
- プラガブルなマーカートランスフォーマー拡張ポイント
- Rank Math 等の SEO メタ設定

## ステータス

骨組みのみ。実装は Phase 1（[`pitolick/ecomi`](https://github.com/pitolick/ecomi) の plan 参照）で進める。

## ライセンス

MIT
