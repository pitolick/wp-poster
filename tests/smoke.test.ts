import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { WP_POSTER_VERSION } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('wp-poster smoke test', () => {
  it('exports a version string', () => {
    expect(typeof WP_POSTER_VERSION).toBe('string');
  });

  it('WP_POSTER_VERSION は package.json の version と一致する', () => {
    // publish で外部公開される版番号。定数と package.json の drift を防ぐ。
    expect(WP_POSTER_VERSION).toBe(pkg.version);
  });
});
