import { afterEach, describe, expect, test, vi } from 'vitest';
import { SlidingWindowLimiter } from '../../src/limiter.js';
import { ONE_MIB, appWith, echo, expectError, paddedJson, postRaw, rateLimitHeaders, reset } from './helpers.js';

describe('errors and routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each([
    ['GET', '/api/unknown'],
    ['POST', '/api/echo'],
    ['GET', '/api/test/reset'],
    ['GET', '/api/echo/?x=a'],
    ['GET', '/API/ECHO?x=a'],
    ['GET', '/api/%ZZ'],
    ['OPTIONS', '/api/echo'],
    ['DELETE', '/api/echo?x=a'],
  ] as const)('HTTP-02 HTTP-04: EX-H11 %s %s returns 404 NOT_FOUND and counts nothing', async (method, url) => {
    const app = await appWith();

    const res = await app.inject({ method, url, headers: { 'x-api-key': 'k1' } });

    expectError(res, 404, 'NOT_FOUND');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(rateLimitHeaders(await echo(app)).remaining).toBe('2');
  });

  test('HTTP-04: EX-H11 HEAD /api/echo returns 404 without a body and counts nothing', async () => {
    const app = await appWith();

    const res = await app.inject({ method: 'HEAD', url: '/api/echo?x=a', headers: { 'x-api-key': 'k1' } });

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
    expect(rateLimitHeaders(await echo(app)).remaining).toBe('2');
  });

  test.each([
    ['a malformed JSON body', '{', 'application/json'],
    ['an oversized body', JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 1) }), 'application/json'],
  ])('HTTP-04: EX-H11 an unknown route with %s still returns 404', async (_name, payload, contentType) => {
    const app = await appWith();

    const res = await app.inject({ method: 'POST', url: '/api/echo', payload, headers: { 'content-type': contentType } });

    expectError(res, 404, 'NOT_FOUND');
  });

  test('HTTP-02 HTTP-03: an unexpected failure returns 500 INTERNAL_ERROR', async () => {
    const app = await appWith();
    vi.spyOn(SlidingWindowLimiter.prototype, 'evaluate').mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await echo(app);

    expectError(res, 500, 'INTERNAL_ERROR');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  test('HTTP-01 HTTP-02 HTTP-03: every error code uses the same JSON body and Content-Type', async () => {
    const app = await appWith([{ apiKey: 'k1', limit: 1, windowMs: 1000, burst: 0 }]);
    await echo(app);

    const cases = [
      [await reset(app, { now: -1, keys: [] }), 400, 'VALIDATION_ERROR'],
      [await postRaw(app, '/api/test/reset', '{bad', 'application/json'), 400, 'VALIDATION_ERROR'],
      [await postRaw(app, '/api/test/reset', paddedJson({ now: 0 }, ONE_MIB + 1)), 413, 'PAYLOAD_TOO_LARGE'],
      [await echo(app, { key: null }), 401, 'MISSING_API_KEY'],
      [await echo(app, { key: 'nope' }), 401, 'INVALID_API_KEY'],
      [await app.inject({ method: 'GET', url: '/nope' }), 404, 'NOT_FOUND'],
      [await echo(app), 429, 'RATE_LIMITED'],
    ] as const;

    for (const [res, status, code] of cases) expectError(res, status, code);
  });
});
