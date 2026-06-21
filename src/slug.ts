/**
 * WordPress の `sanitize_title` 相当で文字列を URL スラッグに正規化する。
 * - 小文字化、アクセント除去
 * - 英数字以外の連続を単一ハイフンに置換
 * - 前後ハイフンを除去
 * 英数字のみの入力に対しては無損失（単射）であることを利用側が前提にする。
 */
export function sanitizeSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
