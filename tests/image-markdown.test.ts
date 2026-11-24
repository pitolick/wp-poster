import { describe, it, expect } from 'vitest';
import {
  parseImageMarkdown,
  formatImageMarkdown,
  renderImageBlock,
} from '../src/image-markdown.js';
import { markdownToBlocks } from '../src/markdown.js';
import { WPPosterError } from '../src/errors.js';

// 正解データは、ブロックエディタで作られて WP に保存されている実際の画像ブロック
// （フィルムログ filmlog.pitolick.com の記事から採取。2026-11-24）
const GOLDEN = {
  caption: {
    md: '![沈黙の艦隊 北極海大海戦](https://filmlog.pitolick.com/wp-content/uploads/2025/09/Gw7u9bIaMAAaDu6-724x1024.jpg "https://x.com/silent_KANTAI/status/1949923062134055097"){id=712 size=large}',
    html:
      '<!-- wp:image {"id":712,"sizeSlug":"large","linkDestination":"none"} -->\n' +
      '<figure class="wp-block-image size-large"><img src="https://filmlog.pitolick.com/wp-content/uploads/2025/09/Gw7u9bIaMAAaDu6-724x1024.jpg" alt="沈黙の艦隊 北極海大海戦" class="wp-image-712"/><figcaption class="wp-element-caption">https://x.com/silent_KANTAI/status/1949923062134055097</figcaption></figure>\n' +
      '<!-- /wp:image -->',
  },
  resized: {
    md: '![ミッション：インポッシブル／ゴースト・プロトコル](https://cdn.getshifter.co/2c736bac2917bf1b9329a1184f03f79791a2e30a/uploads/2025/05/GlwXhW9XQAAB88L-691x1024.jpg){id=624 size=large width=852px height=auto}',
    html:
      '<!-- wp:image {"id":624,"width":"852px","height":"auto","sizeSlug":"large","linkDestination":"none"} -->\n' +
      '<figure class="wp-block-image size-large is-resized"><img src="https://cdn.getshifter.co/2c736bac2917bf1b9329a1184f03f79791a2e30a/uploads/2025/05/GlwXhW9XQAAB88L-691x1024.jpg" alt="ミッション：インポッシブル／ゴースト・プロトコル" class="wp-image-624" style="width:852px;height:auto"/></figure>\n' +
      '<!-- /wp:image -->',
  },
  full: {
    md: '![トランスフォーマー／ONE](https://cdn.getshifter.co/2c736bac2917bf1b9329a1184f03f79791a2e30a/uploads/2024/09/GQ_X-RPacAA_Hcn.jpg){id=496 size=full}',
    html:
      '<!-- wp:image {"id":496,"sizeSlug":"full","linkDestination":"none"} -->\n' +
      '<figure class="wp-block-image size-full"><img src="https://cdn.getshifter.co/2c736bac2917bf1b9329a1184f03f79791a2e30a/uploads/2024/09/GQ_X-RPacAA_Hcn.jpg" alt="トランスフォーマー／ONE" class="wp-image-496"/></figure>\n' +
      '<!-- /wp:image -->',
  },
};

describe('renderImageBlock: WP が保存する形と 1 文字単位で一致する', () => {
  for (const [name, g] of Object.entries(GOLDEN)) {
    it(name, () => {
      const image = parseImageMarkdown(g.md);
      expect(image).not.toBeNull();
      expect(renderImageBlock(image!)).toBe(g.html);
    });
  }

  it('markdownToBlocks でも同じ出力になる', () => {
    expect(markdownToBlocks(GOLDEN.resized.md)).toBe(GOLDEN.resized.html);
  });

  it('id があり size を省略したら sizeSlug は large', () => {
    const out = renderImageBlock({ alt: 'a', src: 'https://e/x.jpg', id: 5 });
    expect(out).toContain('<!-- wp:image {"id":5,"sizeSlug":"large","linkDestination":"none"} -->');
    expect(out).toContain('<figure class="wp-block-image size-large">');
  });

  it('属性が 1 つも無い画像は従来どおり属性なしで出す', () => {
    expect(renderImageBlock({ alt: 'a', src: 'https://e/x.jpg' })).toBe(
      '<!-- wp:image -->\n<figure class="wp-block-image"><img src="https://e/x.jpg" alt="a"/></figure>\n<!-- /wp:image -->',
    );
  });

  it('alt の " < & は属性値としてエスケープし、キャプションの < & は本文としてエスケープする', () => {
    const out = renderImageBlock({
      alt: 'A "B" <C> & D',
      src: 'https://e/x.jpg',
      caption: '1 < 2 & "q"',
    });
    expect(out).toContain('alt="A &quot;B&quot; &lt;C&gt; &amp; D"');
    expect(out).toContain('<figcaption class="wp-element-caption">1 &lt; 2 &amp; "q"</figcaption>');
  });

  it('空のキャプションは figcaption を出さない', () => {
    expect(renderImageBlock({ alt: 'a', src: 'https://e/x.jpg', caption: '' })).not.toContain(
      'figcaption',
    );
  });
});

describe('parseImageMarkdown / formatImageMarkdown', () => {
  it('画像の行でなければ null', () => {
    expect(parseImageMarkdown('ただの段落')).toBeNull();
    expect(parseImageMarkdown('文中の ![a](https://e/x.jpg) 画像')).toBeNull();
    expect(parseImageMarkdown('![a](https://e/x.jpg)\n続きの行')).toBeNull();
  });

  it('前後の空白は許す', () => {
    expect(parseImageMarkdown('  ![a](https://e/x.jpg)  ')).toEqual({
      alt: 'a',
      src: 'https://e/x.jpg',
    });
  });

  it('属性をすべて読む', () => {
    expect(
      parseImageMarkdown('![a](https://e/x.jpg "cap"){id=7 size=medium width=50% height=auto}'),
    ).toEqual({
      alt: 'a',
      src: 'https://e/x.jpg',
      caption: 'cap',
      id: 7,
      size: 'medium',
      width: '50%',
      height: 'auto',
    });
  });

  it('知らない属性・不正な値は例外（黙って意図と違う画像を投稿しない）', () => {
    expect(() => parseImageMarkdown('![a](https://e/x.jpg){align=center}')).toThrow(WPPosterError);
    expect(() => parseImageMarkdown('![a](https://e/x.jpg){id=abc}')).toThrow(WPPosterError);
    expect(() => parseImageMarkdown('![a](https://e/x.jpg){id=0}')).toThrow(WPPosterError);
    expect(() => parseImageMarkdown('![a](https://e/x.jpg){width=wide}')).toThrow(WPPosterError);
  });

  it('format → parse で元に戻る（WP→MD の逆変換で情報が欠けない）', () => {
    for (const g of Object.values(GOLDEN)) {
      const image = parseImageMarkdown(g.md)!;
      expect(formatImageMarkdown(image)).toBe(g.md);
      expect(parseImageMarkdown(formatImageMarkdown(image))).toEqual(image);
    }
  });

  it('alt の ] とキャプションの " をエスケープして往復できる', () => {
    const image = { alt: 'a]b\\c', src: 'https://e/x.jpg', caption: 'say "hi" \\o/' };
    const line = formatImageMarkdown(image);
    expect(line).toBe('![a\\]b\\\\c](https://e/x.jpg "say \\"hi\\" \\\\o/")');
    expect(parseImageMarkdown(line)).toEqual(image);
  });
});

describe('markdownToBlocks: 参照形式の画像（レビュー指摘）', () => {
  it('![a][ref] の単独画像も core/image にする', () => {
    const out = markdownToBlocks('![ポスター][p]\n\n[p]: https://e/p.jpg');
    expect(out).toContain(
      '<!-- wp:image -->\n<figure class="wp-block-image"><img src="https://e/p.jpg" alt="ポスター"/></figure>\n<!-- /wp:image -->',
    );
  });
});

describe('markdownToBlocks: 引用の中の画像', () => {
  it('引用の中の画像も画像ブロックにする', () => {
    const out = markdownToBlocks('> ![ポスター](https://e/p.jpg){id=450 size=full}');
    expect(out).toContain(
      '<!-- wp:image {"id":450,"sizeSlug":"full","linkDestination":"none"} -->\n<figure class="wp-block-image size-full"><img src="https://e/p.jpg" alt="ポスター" class="wp-image-450"/></figure>',
    );
    expect(out.startsWith('<!-- wp:quote -->')).toBe(true);
  });
});

describe('markdownToBlocks: 画像の行と文章が同じ段落になったとき（レビュー指摘）', () => {
  it('引用の中で画像の直後に引用元が続いても、画像ブロックと段落に分ける', () => {
    const out = markdownToBlocks(
      '> ![ポスター](https://e/p.jpg){id=450 size=full}\n> 引用元：公式',
    );
    expect(out).toContain(
      '<!-- wp:image {"id":450,"sizeSlug":"full","linkDestination":"none"} -->',
    );
    expect(out).toContain('<p>引用元：公式</p>');
    expect(out).not.toContain('{id=');
  });

  it('文章 → 画像 → 文章の順でも分ける', () => {
    const out = markdownToBlocks('前\n![a](https://e/a.jpg){id=1}\n後');
    const order = ['<p>前</p>', 'wp-image-1', '<p>後</p>'].map((s) => out.indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('markdownToBlocks: 改行をまたぐインラインコード（レビュー指摘）', () => {
  it('インラインコードの中の画像の記法は画像ブロックにしない', () => {
    const out = markdownToBlocks('説明 `\n![a](https://e/a.jpg)\n`');
    expect(out).not.toContain('wp:image');
    expect(out).toContain('<code>');
    expect((out.match(/<!-- wp:paragraph -->/g) ?? []).length).toBe(1);
  });
});
