import { describe, it, expect } from 'vitest';
import { WPPosterError, WPRequestError } from '../src/errors.js';

describe('WPPosterError', () => {
  it('Error のサブクラスである', () => {
    const err = new WPPosterError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
    expect(err.name).toBe('WPPosterError');
  });
});

describe('WPRequestError', () => {
  it('status / body を保持する', () => {
    const err = new WPRequestError('400 Bad Request', 400, { code: 'rest_invalid' });
    expect(err).toBeInstanceOf(WPPosterError);
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ code: 'rest_invalid' });
    expect(err.name).toBe('WPRequestError');
  });
});
