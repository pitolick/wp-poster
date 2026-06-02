# CLAUDE.md — wp-poster

## プロジェクト概要

WordPress 投稿機構の汎用 TypeScript ライブラリ。複数の WordPress 投稿プロジェクトから submodule として利用される想定で設計されている。

- Markdown を Gutenberg ブロックに変換し、WordPress REST API で投稿する責務だけを持つ
- 記事生成・サイト固有ロジックは含めない（呼び出し側の責務）
- 単独で `npm test` / `npm run typecheck` が成立する自己完結リポジトリ

Issue の起票・Claude Code GitHub Actions の起動は通常 **利用側の親リポジトリで行う**（このライブラリは PR レビューのみ）。

---

## このリポジトリの責務

| 関数・モジュール | 役割 |
|---|---|
| `src/client.ts` | WordPress REST API クライアント（Application Password 認証・投稿・更新・タグ・カテゴリ） |
| `src/markdown.ts` | Markdown → Gutenberg ブロック変換 |
| `src/transformers.ts` | プラガブルなマーカートランスフォーマー拡張ポイント |
| `src/images.ts` | 画像ダウンロード・リサイズ・アップロード |
| `src/meta.ts` | Rank Math 等の SEO メタ設定 |
| `src/cache-bust.ts` | （将来）キャッシュクリア API 呼出フック |
| `src/draft/` (sub-export `@pitolick/wp-poster/draft`) | frontmatter 付き Markdown ドラフトの解析・検証・PostInput への変換 |

### frontmatter 拡張キーの方針

`DraftFrontmatter` は WP REST API に直接対応するフィールド（`title` / `categories` / `meta` 等）に加えて、`source?: Record<string, unknown>` という **orchestrator 用トレースメタ** 専用キーを 1 つだけ許容する。

- `source` は wp-poster では値を一切解釈せず、`adaptToPostInput` で `PostInput` から除外する（= WP には送らない）
- 用途: 呼び出し側（Claude Routine 等）が「どのスキル・生成器でこのドラフトを作ったか」を frontmatter に残せるようにする
- それ以外の未知トップレベルキーは `warnings` に乗る（実害なしの検知ノイズ抑止のため、`source` だけ known key に追加した経緯）

---

## 技術スタック

| 項目 | 採用技術 |
|---|---|
| 言語 | TypeScript 5.6+ |
| ランタイム | Node.js 20+ (ESM) |
| テスト | Vitest（外部 API はモック） |
| Lint | ESLint 9 (flat config) |
| Formatter | Prettier 3 |

---

## 開発ルール

- コミットメッセージ・PR・Issue はすべて日本語で記述
- 公開 API はすべて TypeScript の型をエクスポート
- WP REST API・外部 HTTP 呼出しは必ずモックしてテスト可能にする
- サイト固有ロジック（特定の WordPress URL・特定のプラグイン依存）を混入させない

### コミットメッセージ形式

```
feat: 〇〇機能を追加
fix: 〇〇のバグを修正
chore: ライブラリを更新
test: テストを追加・修正
refactor: 〇〇をリファクタリング
docs: ドキュメントを更新
```

---

## 動作確認とレビューの分担

- **機械的に検証できる「動くか」の確認は自動テスト（Vitest）と CI で行い、人間に手動確認させない**。UI を持つ実装は Playwright による E2E で検証する（本パッケージは UI を持たない汎用 TS のため通常は Vitest で十分。利用側 WordPress 等での結合確認が必要なら、その E2E は CI または Docker 上の実行環境で回す）。
- **実装が一通り終わった後のテストは必須**。途中の PR でも相応のテストを用意し、機械確認を人間に肩代わりさせない。
- **人間のレビューは人間にしか判断できない観点に限定する**：実装が要件・意図通りか、API 設計の妥当性、ほかに追加すべき要望がないか等。

---

## 仕様書の場所

設計の全体像は利用側プロジェクトの設計書を参照する。このリポジトリ単体での公開仕様は README.md と `src/types.ts` の TSDoc に集約する。
