# wp-poster

WordPress 投稿機構の汎用 TypeScript ライブラリ。`@pitolick/wp-poster` として `filmlog-ai`・`ai-article-poster` など複数プロジェクトから submodule として利用される。

## 責務

- WordPress REST API クライアント（Application Password 認証）
- Markdown → Gutenberg ブロック変換（`marked` ベース）
- プラガブルなマーカートランスフォーマー拡張ポイント
- 画像のダウンロード・アップロード
- Rank Math 等の SEO メタ設定
- キャッシュバストフックポイント（将来用）

## 使い方

```ts
import { WPPoster } from '@pitolick/wp-poster';
import type { MarkerTransformer } from '@pitolick/wp-poster';

const affilicardMarker: MarkerTransformer = {
  pattern: /\[affilicard id="(\d+)"\]/g,
  toBlock: (m) => `<!-- wp:shortcode -->\n[affilicard id="${m[1]}"]\n<!-- /wp:shortcode -->`,
};

const poster = new WPPoster({
  url: process.env.WP_URL!,
  username: process.env.WP_USERNAME!,
  appPassword: process.env.WP_APP_PASSWORD!,
});

const post = await poster.publish({
  title: '今月のセール',
  content: '本日から〜\n\n[affilicard id="42"]\n\n以上です。',
  status: 'draft',
  tags: ['manga', 'sale'],
  categories: ['blog'],
  featuredImage: { source: 'https://cdn.example.com/cover.jpg', alt: 'カバー' },
  meta: { rank_math_title: 'SEO タイトル', rank_math_description: 'SEO 説明' },
  markerTransformers: [affilicardMarker],
});

console.log(post.link);
```

## API

### `new WPPoster(config: WPPosterConfig)`

| プロパティ | 必須 | 説明 |
| --- | --- | --- |
| `url` | ✓ | WordPress のベース URL（末尾スラッシュなし） |
| `username` | ✓ | WP ユーザー名 |
| `appPassword` | ✓ | Application Password |
| `fetch` | | テスト等から差し替える fetch 実装 |

### `poster.publish(input, options?)`

新規投稿を作成する。詳細は `src/types.ts` の `PostInput` 型参照。

### `poster.update(id, input, options?)`

既存投稿を更新する。`input` は `PostInput` の部分集合。

### マーカートランスフォーマー

Markdown 中の任意パターンを Gutenberg ブロックに置換する。

```ts
interface MarkerTransformer {
  pattern: RegExp;     // global フラグ必須（無ければ自動付与）
  toBlock: (match: RegExpMatchArray) => string;  // 出力するブロック HTML
}
```

未マッチ部分は通常の Markdown → Gutenberg 変換にかけられる。

## サポートされる Gutenberg ブロック

| Markdown | Gutenberg ブロック |
| --- | --- |
| `# 見出し` (h1〜h6) | `core/heading` |
| 段落 | `core/paragraph` |
| `- list` / `1. list` | `core/list` |
| `> blockquote` | `core/quote` |
| ` ```code``` ` | `core/code` |
| `---` | `core/separator` |
| `![alt](url)` 単独段落 | `core/image` |
| 上記以外 | `core/html` フォールバック |

## テスト

```bash
npm test          # ルート（e-comi）から
npm run test:watch
```

外部 API（WP REST）はすべて `vi.fn()` でモックされる。

## WordPress Playground での動作確認

`blueprints/dev.json` を [WordPress Playground](https://playground.wordpress.net/) で開くと、Rank Math セットアップ済みの WP インスタンスがブラウザ上で起動する。

```text
https://playground.wordpress.net/#https://raw.githubusercontent.com/pitolick/wp-poster/main/blueprints/dev.json
```

## ライセンス

MIT
