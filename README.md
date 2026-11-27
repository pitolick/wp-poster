# wp-poster

WordPress 投稿機構の汎用 TypeScript ライブラリ。`@pitolick/wp-poster` として複数プロジェクトから **GitHub Packages（npm registry）** 経由で利用される。

## インストール

GitHub Packages（`@pitolick` スコープ）で配布している。利用側リポジトリに `.npmrc` を置き、`read:packages` 権限のトークンを渡す。

```ini
# .npmrc
@pitolick:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
npm install @pitolick/wp-poster
```

- **配布物**: ESM の `.js` + `.d.ts`（`dist/`）。`type: module`。tsx でも plain node でも import 可能。
- **サブパス**: frontmatter 解析は `@pitolick/wp-poster/draft` から import する。

### 認証（利用者別）

事前に、パッケージの **Package settings → Manage Actions access** で利用側リポジトリに **Read** access を付与しておく。

| 利用者 | 認証 |
| --- | --- |
| **CI（GitHub Actions）** | `NODE_AUTH_TOKEN` に `GITHUB_TOKEN`（job に `permissions: packages: read`）。PAT 不要。 |
| **Dependabot** | パッケージに対象リポジトリの Read access を付与すれば `GITHUB_TOKEN` で自動認証される（2026-06-23 以降・GitHub ホスト registry のみ）。`dependabot.yml` への PAT 登録は不要。 |
| **ローカル** | `read:packages` 権限の PAT を `~/.npmrc`（または `NODE_AUTH_TOKEN`）に設定。 |

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

// Markdown 中の独自パターンを Gutenberg ブロックに置換するマーカーの例
// 注意: Gutenberg のブロックバリデーションが厳格なため、各ブロック種別の
// 公式正規形式（属性 / class / 改行位置）を厳密に守る必要がある。
// 不足があるとエディタで「無効なコンテンツ」と表示される。
const youtubeMarker: MarkerTransformer = {
  pattern: /\[youtube id="([\w-]+)"\]/g,
  toBlock: (m) => {
    const url = `https://www.youtube.com/watch?v=${m[1]}`;
    const attrs = JSON.stringify({
      url,
      type: 'video',
      providerNameSlug: 'youtube',
      responsive: true,
      className: 'wp-embed-aspect-16-9 wp-has-aspect-ratio',
    });
    return (
      `<!-- wp:embed ${attrs} -->\n` +
      `<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio">` +
      `<div class="wp-block-embed__wrapper">\n` +
      `${url}\n` +
      `</div></figure>\n` +
      `<!-- /wp:embed -->`
    );
  },
};

const poster = new WPPoster({
  url: process.env.WP_URL!,
  username: process.env.WP_USERNAME!,
  appPassword: process.env.WP_APP_PASSWORD!,
});

const post = await poster.publish({
  title: 'サンプル投稿',
  content: '本文の前置き。\n\n[youtube id="dQw4w9WgXcQ"]\n\n埋め込みの後の段落。',
  status: 'draft',
  tags: ['typescript', 'wordpress'],
  categories: ['blog'],
  featuredImage: { source: 'https://example.com/cover.jpg', alt: 'カバー画像' },
  meta: { rank_math_title: 'SEO タイトル', rank_math_description: 'SEO 説明' },
  markerTransformers: [youtubeMarker],
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

### `poster.upsertBySlug(postType, input, options?)`

`input.slug` を自然キーに、一致する投稿があれば更新（`slug` は再送しない）、無ければ作成する。記事（`posts`）とカスタム投稿タイプ（`affilicard_product` など）を共通で扱う。戻り値は `{ id, created, link, contentImages? }`（`contentImages` は本文の画像を解決したときだけ。後述）。

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `statusOnUpdate` | `'send'` | 既存投稿を**更新するとき**に `input.status` を送るか。`'omit'` にすると送らず、WP 上の公開状態を保つ（draft の `status: draft` で公開記事を下書きに戻す事故を防ぐ）。新規作成では常に送る |
| `cacheBust` / `fetch` / `resolveContentImages` / `contentImagesBaseDir` / `onContentImage` | — | `publish` / `update` と同じ（本文の画像は後述） |

```ts
// 公開状態は WP 管理画面で決める運用（再投稿で下書きに戻さない）
await poster.upsertBySlug('posts', input, { statusOnUpdate: 'omit' });
```

### 一覧を全ページ取る（`WPClient.getPage` / `WPClient.getAll`）

`WPClient.get` は本文だけを返すので、一覧系エンドポイントのページ数（`X-WP-Total` / `X-WP-TotalPages`）を読めない。全件が要るときはこちらを使う。

```ts
import { WPClient } from '@pitolick/wp-poster';

const client = new WPClient({ url, username, appPassword });

// 1 ページ分と総件数・総ページ数（ヘッダが無ければ null）
const { items, total, totalPages } = await client.getPage('/wp-json/wp/v2/tags?per_page=100&page=1');

// 最後のページまでたどる（per_page が無ければ 100 を付ける）
const tags = await client.getAll('/wp-json/wp/v2/tags?_fields=id,name,slug');
```

- WP は権限で読めない項目をページから抜くが、総ページ数は抜く前の件数で数える。そのため `getAll` は「件数が `per_page` に満たないページ」ではなく **`X-WP-TotalPages` まで**たどる（ヘッダが無いときだけ、満たないページで終える）
- `maxPages`（既定 1000）を超えたら `WPPosterError` を投げる。黙って途中で打ち切らない

### 本文の画像

本文の画像は、単独行で次のように書く（引用 `> ` の中に書いてもよい）。`{…}` は省略できる。

```md
![alt](src "キャプション"){id=712 size=large width=852px height=auto}
```

| 属性 | 意味 | 既定 |
| --- | --- | --- |
| `id` | メディア ID。あると `class="wp-image-N"` が付き、ブロックエディタで正しい画像ブロックとして扱える（差し替え・画面幅に合わせた画像の自動付与） | なし |
| `size` | `sizeSlug`（`large` / `full` など） | `id` があれば `large` |
| `width` / `height` | 表示サイズ（エディタの「サイズ変更」） | なし |

`publish` / `update` / `upsertBySlug` は、**`id` の無い画像を投稿前にメディアライブラリへ解決する**。

1. 元の URL の SHA-256（リポジトリ内のファイルなら中身の SHA-256）の先頭 12 桁を「鍵」にする
2. 鍵入りのタイトルを持つメディアがあれば再利用する。無ければ `<元の名前>-<鍵>.<拡張子>` でアップロードする（**何度投稿してもメディアは 1 枚のまま**）
3. `id`・サイズ別の URL・`size` を埋めてから画像ブロックにする。新たにアップロードしたメディアには、投稿確定後に親投稿を設定する

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `resolveContentImages` | `true` | `false` なら解決せず、Markdown の src のまま画像ブロックにする（外部 URL への直リンク） |
| `contentImagesBaseDir` | なし | http(s) でない src（リポジトリ内のファイル）を読む基準ディレクトリ。未指定ならそのような画像は解決しない |
| `onContentImage` | なし | 1 枚ごとの判断（`reused` / `uploaded` / `skipped`）を受け取る。**ログに残すこと**（無言でアップロードに倒れると、メディアが増えてから気づくことになる） |

同じ URL のまま中身が差し替わる画像は、鍵が変わらないので古いメディアが使われ続ける。その場合は別の URL（またはファイル）にする。

各サイトの独自の変換器からも使えるよう、次を公開している。

| 関数 | 用途 |
| --- | --- |
| `parseImageMarkdown(line)` / `formatImageMarkdown(image)` | 記法の解析と書き出し（WP → Markdown の逆変換にも使う） |
| `renderImageBlock(image)` | 画像ブロックの出力。ブロックエディタが保存する形と同じ（Gutenberg のブロック検証で、無効にならず保存し直しても変わらないことを確認済み） |
| `resolveContentImages(markdown, client, options)` | 上の「探して無ければ上げる」だけを行う |

### マーカートランスフォーマー

Markdown 中の任意パターンを Gutenberg ブロックに置換する。

```ts
interface MarkerTransformer {
  pattern: RegExp; // global フラグ必須（無ければ自動付与）
  toBlock: (match: RegExpMatchArray) => string; // 出力するブロック HTML
}
```

未マッチ部分は通常の Markdown → Gutenberg 変換にかけられる。

#### マーカー配置の制約

マーカーは **空行で囲んだ独立した段落** として配置すること。

```md
本文の段落。

[youtube id="dQw4w9WgXcQ"]

次の段落。
```

`toBlock` は Gutenberg の**トップレベルブロック**を返す前提のため、マーカーを段落の途中（インライン）に置くと、生成されたブロックが `<p>...</p>` の中に混入して Gutenberg が「無効なコンテンツ」として表示する可能性がある。

#### ブロック HTML 形式の厳密さ

Gutenberg のブロックバリデーションは寛容ではなく、`responsive` 属性 1 つ・class 1 つの欠落でブロック全体を破棄して空段落表示にする。`toBlock` で返す HTML は、エディタ画面で正しく表示されたブロックを「コードエディタ」表示でコピーした値を基準に組み立てるのが確実。

## サポートされる Gutenberg ブロック

| Markdown | Gutenberg ブロック |
| --- | --- |
| `# 見出し` (h1〜h6) | `core/heading` |
| 段落 | `core/paragraph` |
| `- list` / `1. list` | `core/list` |
| `> blockquote` | `core/quote` |
| ` ```code``` ` | `core/code` |
| `---` | `core/separator` |
| `![alt](src "キャプション"){id=… size=…}` 単独段落 | `core/image`（[本文の画像](#本文の画像)） |
| 上記以外 | `core/html` フォールバック |

## Markdown ドラフトファイルからの投稿

frontmatter 付き Markdown ファイルを直接読んで投稿できます。

```typescript
import { readFileSync } from 'node:fs';
import { WPPoster } from '@pitolick/wp-poster';
import { parseDraft } from '@pitolick/wp-poster/draft';

const md = readFileSync('drafts/2026-05-21-sale-test.md', 'utf8');
const { input, errors, warnings } = parseDraft(md);
if (errors.length > 0) {
  console.error(errors);
  process.exit(1);
}
if (warnings.length > 0) {
  console.warn(warnings);
}

const poster = new WPPoster({ url, username, appPassword });
await poster.publish({
  ...input!,
  markerTransformers: [affilicardMarker], // サイト固有マーカーは呼び出し側で注入
});
```

### Draft の frontmatter スキーマ

```yaml
---
# 必須
title: 「テスト作品 A」が 50% OFF — 期間限定セール

# オプション（PostInput と 1:1 対応）
slug: sale-test-work-a-2026-05
status: draft # draft / publish / future / pending / private
date: 2026-05-21T19:00:00+09:00 # status='future' で予約投稿
excerpt: 短い抜粋
author: 1
categories:
  - 漫画
tags:
  - セール
featuredImage:
  source: https://example.com/cover.jpg
  alt: 表紙
meta:
  rank_math_title: SEO タイトル

# オプション（orchestrator 用トレースメタ。wp-poster は解釈せず WP にも送らない）
source:
  generator: claude-routine
  skill: e-comi-sale-check
---
```

`source` は orchestrator がドラフト生成元を追跡するための拡張キーで、`Record<string, unknown>` として任意の構造を受け入れます。値は wp-poster では一切解釈せず、`PostInput` にも含めないため WP REST API には送信されません（warning も出ません）。それ以外の未知のトップレベルキーは `warnings` に乗りますが、`errors` にはなりません（PostInput からも除外されます）。

`validateDraft(markdown)` は parse + 検証のみを行い、PostInput への変換は省略します。CI で frontmatter スキーマを軽量に確認したい場合に使えます。

## テスト

```bash
npm test          # 単独リポジトリのルートで実行
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
