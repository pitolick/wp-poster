import { describe, it, expect } from 'vitest';
import { WP_POSTER_VERSION } from '../src/index.js';

describe('wp-poster smoke test', () => {
  it('exports a version string', () => {
    expect(typeof WP_POSTER_VERSION).toBe('string');
    expect(WP_POSTER_VERSION).toBe('0.0.0');
  });
});
