import { describe, it, expect } from 'vitest';
import { normalizeTitleSeparators } from '../src/title.js';

describe('normalizeTitleSeparators', () => {
  it('CJK 直後の半角コロンを全角に変換する（オーメン事例）', () => {
    // 半角 ":" は Google がタイトル区切りとみなし後半を落とす（「オーメン」だけ表示される）。
    expect(normalizeTitleSeparators('オーメン:ザ・ファースト')).toBe('オーメン：ザ・ファースト');
  });

  it('CJK 直後の半角スラッシュ・パイプも全角にする', () => {
    expect(normalizeTitleSeparators('鬼滅の刃/遊郭編')).toBe('鬼滅の刃／遊郭編');
    expect(normalizeTitleSeparators('作品名|副題')).toBe('作品名｜副題');
  });

  it('前後どちらかに空白がある半角区切りは（言語を問わず）全角化し空白を畳む', () => {
    expect(normalizeTitleSeparators('作品A / 作品B')).toBe('作品A／作品B');
    expect(normalizeTitleSeparators('本編 : 副題')).toBe('本編：副題');
    expect(normalizeTitleSeparators('記事 | サイト名')).toBe('記事｜サイト名');
    expect(normalizeTitleSeparators('A /B')).toBe('A／B');
    expect(normalizeTitleSeparators('A/ B')).toBe('A／B');
  });

  it('Latin 直後・空白なしの半角コロンは公式表記として保護する（Re:ゼロ）', () => {
    expect(normalizeTitleSeparators('Re:ゼロから始める異世界生活')).toBe(
      'Re:ゼロから始める異世界生活',
    );
  });

  it('対象外の記号を含むブランド名は変更しない', () => {
    expect(normalizeTitleSeparators('Dr.STONE')).toBe('Dr.STONE');
    expect(normalizeTitleSeparators('SPY×FAMILY')).toBe('SPY×FAMILY');
  });

  it('Latin 間・空白なしの区切りは変換しない（URL 等の誤変換防止）', () => {
    expect(normalizeTitleSeparators('A/B')).toBe('A/B');
    expect(normalizeTitleSeparators('https://example.com')).toBe('https://example.com');
  });

  it('冪等である（2 回適用しても変わらない）', () => {
    const once = normalizeTitleSeparators('オーメン:ザ・ファースト｜特集 / まとめ');
    expect(normalizeTitleSeparators(once)).toBe(once);
  });

  it('既に全角の区切りはそのまま保つ', () => {
    expect(normalizeTitleSeparators('オーメン：ザ・ファースト')).toBe('オーメン：ザ・ファースト');
  });
});
