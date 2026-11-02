import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  K1_SINGLE,
  appWith,
  echo,
  expectError,
  expectNoRateLimitHeaders,
  rateLimitHeaders,
  setNow,
} from './helpers.js';

describe('GET /api/echo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('HTTP-01 HTTP-12 HTTP-13 HTTP-14 HTTP-32: EX-H01 full flow', async () => {
    const app = await appWith();

    const responses = [];
    for (let i = 0; i < 4; i++) responses.push(await echo(app, { query: '?x=hello' }));

    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 429]);
    expect(responses.slice(0, 3).map((r) => r.json())).toEqual([{ x: 'hello' }, { x: 'hello' }, { x: 'hello' }]);
    expect(responses[3]?.json()).toStrictEqual({ error: { code: 'RATE_LIMITED' } });
    expect(responses.map(rateLimitHeaders)).toEqual([
      { limit: '3', remaining: '2', reset: '1000', retryAfter: undefined },
      { limit: '3', remaining: '1', reset: '1000', retryAfter: undefined },
      { limit: '3', remaining: '0', reset: '1000', retryAfter: undefined },
      { limit: '3', remaining: '0', reset: '1000', retryAfter: '1' },
    ]);
    for (const res of responses) {
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    }

    const setNowRes = await setNow(app, { now: 1000 });
    expect(setNowRes.statusCode).toBe(200);
    expect(setNowRes.json()).toStrictEqual({ ok: true });

    const after = await echo(app, { query: '?x=hello' });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toStrictEqual({ x: 'hello' });
    expect(rateLimitHeaders(after)).toEqual({ limit: '3', remaining: '2', reset: '1000', retryAfter: undefined });
  });

  test.each([
    ['no X-Api-Key header', null],
    ['an empty X-Api-Key', ''],
    ['an X-Api-Key of spaces only', '   '],
    ['an X-Api-Key of tabs and spaces', ' \t '],
  ])('HTTP-11: EX-H02 %s returns 401 MISSING_API_KEY and counts nothing', async (_name, key) => {
    const app = await appWith();

    const res = await echo(app, { key });

    expectError(res, 401, 'MISSING_API_KEY');
    expectNoRateLimitHeaders(res);
    expect(rateLimitHeaders(await echo(app)).remaining).toBe('2');
  });

  test.each([
    ['a key in another case', 'K1'],
    ['an unconfigured key', 'zzz'],
    ['the header sent twice', ['k1', 'k1']],
  ])('HTTP-11: EX-H03 %s returns 401 INVALID_API_KEY and counts nothing', async (_name, key) => {
    const app = await appWith();

    const res = await echo(app, { key });

    expectError(res, 401, 'INVALID_API_KEY');
    expectNoRateLimitHeaders(res);
    expect(rateLimitHeaders(await echo(app)).remaining).toBe('2');
  });

  test('HTTP-11: EX-H03 surrounding spaces and tabs around the key are ignored', async () => {
    const app = await appWith();

    const res = await echo(app, { key: ' \t k1  ' });

    expect(res.statusCode).toBe(200);
    expect(rateLimitHeaders(res).remaining).toBe('2');
  });

  test('HTTP-15: EX-H04 a missing x returns 200 {} and is counted', async () => {
    const app = await appWith([K1_SINGLE]);

    const res = await echo(app, { query: '' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({});
    expect(rateLimitHeaders(res)).toEqual({ limit: '1', remaining: '0', reset: '1000', retryAfter: undefined });
    expectError(await echo(app), 429, 'RATE_LIMITED');
  });

  test.each([
    ['?x=', { x: '' }],
    ['?x', { x: '' }],
    ['?x=a%20b', { x: 'a b' }],
    ['?x=a+b', { x: 'a b' }],
    ['?x=%ZZ', { x: '%ZZ' }],
    ['?x=a%20b%ZZ', { x: 'a b%ZZ' }],
    ['?x=%C3%28', { x: '\ufffd(' }],
    ['?x=5', { x: '5' }],
    ['?x=1&x=2', { x: '1' }],
    ['?x=%E2%9C%93&y=ignored', { x: '✓' }],
    ['?X=a', {}],
  ])('HTTP-14 HTTP-15: EX-H05 query %s returns %j', async (query, body) => {
    const app = await appWith();

    const res = await echo(app, { query });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual(body);
  });

  test('HTTP-04: EX-H11 a percent-encoded path is the same route', async () => {
    const app = await appWith();

    const res = await app.inject({ method: 'GET', url: '/api/ech%6F?x=a', headers: { 'x-api-key': 'k1' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ x: 'a' });
    expect(rateLimitHeaders(res).remaining).toBe('2');
  });

  test('HTTP-10: EX-H06 a denied request without x gets 429, a request without key gets 401', async () => {
    const app = await appWith([K1_SINGLE]);
    expect((await echo(app)).statusCode).toBe(200);

    const denied = await echo(app, { query: '' });
    expectError(denied, 429, 'RATE_LIMITED');
    expect(rateLimitHeaders(denied).retryAfter).toBe('1');

    expectError(await echo(app, { key: null, query: '' }), 401, 'MISSING_API_KEY');
  });

  test('HTTP-10: handling a request never changes the clock', async () => {
    const app = await appWith([K1_SINGLE], 300);
    await echo(app);
    await echo(app);

    expect(rateLimitHeaders(await echo(app)).reset).toBe('1000');
  });

  test('HTTP-12: rate-limit header values are plain base-10 integers', async () => {
    const app = await appWith([{ apiKey: 'k1', limit: 1, windowMs: 2 ** 52 - 1, burst: 0 }]);

    const headers = [rateLimitHeaders(await echo(app)), rateLimitHeaders(await echo(app))];

    for (const h of headers) {
      for (const value of [h.limit, h.remaining, h.reset]) expect(value).toMatch(/^\d+$/);
    }
    expect(headers[1]).toEqual({
      limit: '1',
      remaining: '0',
      reset: '4503599627370495',
      retryAfter: '4503599627371',
    });
  });

  test('ALG-01: EX-14 only the gateway clock counts, not the system clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const app = await appWith([K1_SINGLE], 5000);

    const first = await echo(app);
    vi.setSystemTime(1_700_000_000_000 + 60_000);
    const second = await echo(app);

    expect(first.statusCode).toBe(200);
    expect(rateLimitHeaders(first).reset).toBe('1000');
    expectError(second, 429, 'RATE_LIMITED');
    expect(rateLimitHeaders(second).reset).toBe('1000');
  });

  test('ALG-15 HTTP-32: a backwards clock keeps later timestamps in the window', async () => {
    const app = await appWith([K1_SINGLE], 1000);
    await echo(app);
    await setNow(app, { now: 500 });

    const res = await echo(app);

    expectError(res, 429, 'RATE_LIMITED');
    expect(rateLimitHeaders(res)).toEqual({ limit: '1', remaining: '0', reset: '1500', retryAfter: '2' });
  });

  test('ALG-09: keys are limited independently over HTTP', async () => {
    const app = await appWith([K1_SINGLE, { ...K1_SINGLE, apiKey: 'k2' }]);

    expect((await echo(app, { key: 'k1' })).statusCode).toBe(200);
    expect((await echo(app, { key: 'k2' })).statusCode).toBe(200);
    expect((await echo(app, { key: 'k1' })).statusCode).toBe(429);
  });
});
