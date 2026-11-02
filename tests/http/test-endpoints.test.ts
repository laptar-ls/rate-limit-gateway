import { describe, expect, test } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  K1,
  K1_SINGLE,
  ONE_MIB,
  appWith,
  echo,
  expectError,
  expectNoRateLimitHeaders,
  paddedJson,
  postRaw,
  rateLimitHeaders,
  reset,
  setNow,
} from './helpers.js';

const MAX = 2 ** 52 - 1;

/** K(...) of EX-H07: k1 with capacity 1 and one change. */
function k(overrides: Record<string, unknown> = {}, omit?: string): Record<string, unknown> {
  const config: Record<string, unknown> = { ...K1_SINGLE, ...overrides };
  if (omit !== undefined) delete config[omit];
  return config;
}

/** Spec 02 EX-H07 / EX-H10 starting state: k1 capacity 1, one echo allowed at T = 0. */
async function appWithOneAllowedEcho() {
  const app = await appWith([K1_SINGLE]);
  expect((await echo(app)).statusCode).toBe(200);
  return app;
}

const invalidResetBodies: Array<[string, unknown]> = [
  ['without now', { keys: [] }],
  ['without keys', { now: 5000 }],
  ['with keys as an object', { now: 5000, keys: {} }],
  ['that is an array', []],
  ['with now -1', { now: -1, keys: [] }],
  ['with now 1.5', { now: 1.5, keys: [] }],
  ['with now "5000"', { now: '5000', keys: [] }],
  ['with now null', { now: null, keys: [] }],
  ['with now true', { now: true, keys: [] }],
  ['with now [5000]', { now: [5000], keys: [] }],
  ['with now 2^52', { now: MAX + 1, keys: [] }],
  ['with apiKey ""', { now: 5000, keys: [k({ apiKey: '' })] }],
  ['with apiKey " k1"', { now: 5000, keys: [k({ apiKey: ' k1' })] }],
  ['with apiKey "a,b"', { now: 5000, keys: [k({ apiKey: 'a,b' })] }],
  ['with a non-ASCII apiKey', { now: 5000, keys: [k({ apiKey: 'ключ' })] }],
  ['with a numeric apiKey', { now: 5000, keys: [k({ apiKey: 7 })] }],
  ['with limit -1', { now: 5000, keys: [k({ limit: -1 })] }],
  ['with limit 0 and burst 0', { now: 5000, keys: [k({ limit: 0, burst: 0 })] }],
  ['with limit 1.5', { now: 5000, keys: [k({ limit: 1.5 })] }],
  ['with limit "1"', { now: 5000, keys: [k({ limit: '1' })] }],
  ['with windowMs 0', { now: 5000, keys: [k({ windowMs: 0 })] }],
  ['with burst -1', { now: 5000, keys: [k({ burst: -1 })] }],
  ['with a key config without burst', { now: 5000, keys: [k({}, 'burst')] }],
  ['with a key config without apiKey', { now: 5000, keys: [k({}, 'apiKey')] }],
  ['with a null key config', { now: 5000, keys: [null] }],
  ['with a duplicate apiKey', { now: 5000, keys: [k(), k({ limit: 5 })] }],
];

describe('POST /api/test/reset', () => {
  test.each(invalidResetBodies)(
    'HTTP-20 HTTP-21: EX-H07 a body %s returns 400 and keeps config, log and clock',
    async (_name, body) => {
      const app = await appWithOneAllowedEcho();

      expectError(await reset(app, body), 400, 'VALIDATION_ERROR');

      const after = await echo(app);
      expectError(after, 429, 'RATE_LIMITED');
      expect(rateLimitHeaders(after).reset).toBe('1000');
    },
  );

  test.each([
    ['an empty body with Content-Type application/json', '', 'application/json'],
    ['an empty body without Content-Type', '', undefined],
    ['malformed JSON', '{bad json', 'application/json'],
    ['the JSON literal null', 'null', 'application/json'],
    ['the JSON string "x"', '"x"', 'application/json'],
    ['the JSON number 5', '5', 'application/json'],
    ['the JSON literal true', 'true', 'application/json'],
  ])('HTTP-05 HTTP-21: EX-H07 %s returns 400 and keeps state', async (_name, payload, contentType) => {
    const app = await appWithOneAllowedEcho();

    expectError(await postRaw(app, '/api/test/reset', payload, contentType), 400, 'VALIDATION_ERROR');

    const after = await echo(app);
    expectError(after, 429, 'RATE_LIMITED');
    expect(rateLimitHeaders(after).reset).toBe('1000');
  });

  test('HTTP-22: EX-H08 an empty keys array removes every key', async () => {
    const app = await appWith();

    const res = await reset(app, { now: 0, keys: [] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true });
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expectError(await echo(app), 401, 'INVALID_API_KEY');
  });

  test('HTTP-05 HTTP-20: EX-H08 accepts 1.0 and 1e3 as integers, unknown fields and a space inside the key', async () => {
    const app = buildApp();
    const payload =
      '{"now":1.0,"keys":[{"apiKey":"k 1","limit":1e3,"windowMs":1000,"burst":0,"tier":"gold"}],"extra":true}';

    const res = await postRaw(app, '/api/test/reset', payload, 'application/json');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true });
    const echoed = await echo(app, { key: 'k 1' });
    expect(echoed.statusCode).toBe(200);
    expect(rateLimitHeaders(echoed).limit).toBe('1000');
  });

  test('ALG-02 HTTP-20: EX-H08 accepts limit 0 with burst 2', async () => {
    const app = await appWith([{ apiKey: 'b', limit: 0, windowMs: 1000, burst: 2 }]);

    const res = await echo(app, { key: 'b' });

    expect(res.statusCode).toBe(200);
    expect(rateLimitHeaders(res).limit).toBe('2');
  });

  test.each([
    ['text/plain', 'text/plain;charset=UTF-8'],
    ['no Content-Type', undefined],
    ['application/json with a charset', 'application/json; charset=utf-8'],
    ['an unrelated media type', 'application/x-www-form-urlencoded'],
    ['an empty Content-Type', ''],
    ['a malformed Content-Type', 'json'],
  ])('HTTP-05: EX-H08 a JSON body sent with %s is parsed as JSON', async (_name, contentType) => {
    const app = buildApp();

    const res = await postRaw(app, '/api/test/reset', JSON.stringify({ now: 0, keys: [K1] }), contentType);

    expect(res.statusCode).toBe(200);
    expect((await echo(app)).statusCode).toBe(200);
  });

  test('HTTP-22: EX-H09 reset replaces keys', async () => {
    const app = await appWith();

    await reset(app, { now: 0, keys: [{ apiKey: 'k2', limit: 1, windowMs: 1000, burst: 0 }] });

    expectError(await echo(app, { key: 'k1' }), 401, 'INVALID_API_KEY');
    const res = await echo(app, { key: 'k2', query: '?x=a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ x: 'a' });
    expect(rateLimitHeaders(res)).toMatchObject({ limit: '1', remaining: '0' });
  });

  test('ALG-03 HTTP-22: reset empties logs and sets the clock', async () => {
    const app = await appWithOneAllowedEcho();

    await reset(app, { now: 700, keys: [K1_SINGLE] });

    const res = await echo(app);
    expect(res.statusCode).toBe(200);
    expect(rateLimitHeaders(res)).toMatchObject({ remaining: '0', reset: '1000' });
    await setNow(app, { now: 1699 });
    expect(rateLimitHeaders(await echo(app)).reset).toBe('1');
  });

  test('HTTP-05: EX-H08 a body of exactly 1 MiB is accepted', async () => {
    const app = buildApp();

    const res = await postRaw(app, '/api/test/reset', paddedJson({ now: 0, keys: [K1] }, ONE_MIB), 'application/json');

    expect(res.statusCode).toBe(200);
    expect((await echo(app)).statusCode).toBe(200);
  });

  test('HTTP-05 HTTP-21: EX-H14 a body of 1 MiB + 1 byte returns 413 and keeps state', async () => {
    const app = await appWithOneAllowedEcho();
    const payload = paddedJson({ now: 0, keys: [K1] }, ONE_MIB + 1);

    expectError(await postRaw(app, '/api/test/reset', payload, 'application/json'), 413, 'PAYLOAD_TOO_LARGE');
    expectError(await echo(app), 429, 'RATE_LIMITED');
  });
});

describe('POST /api/test/set-now', () => {
  test('HTTP-32: EX-H10 set-now moves the clock and keeps logs', async () => {
    const app = await appWithOneAllowedEcho();

    const res = await setNow(app, { now: 500 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true });
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    const after = await echo(app);
    expectError(after, 429, 'RATE_LIMITED');
    expect(rateLimitHeaders(after)).toMatchObject({ reset: '500', retryAfter: '1' });
  });

  test.each([
    ['{"now":-1}', { now: -1 }],
    ['{"now":"900"}', { now: '900' }],
    ['{"now":1.5}', { now: 1.5 }],
    ['{}', {}],
    ['[]', []],
  ])('HTTP-30 HTTP-31: EX-H10 body %s returns 400 and keeps the clock', async (_name, body) => {
    const app = await appWithOneAllowedEcho();
    await setNow(app, { now: 500 });

    expectError(await setNow(app, body), 400, 'VALIDATION_ERROR');

    expect(rateLimitHeaders(await echo(app)).reset).toBe('500');
  });

  test('HTTP-05 HTTP-31: EX-H10 an empty body returns 400 and keeps the clock', async () => {
    const app = await appWithOneAllowedEcho();
    await setNow(app, { now: 500 });

    expectError(await postRaw(app, '/api/test/set-now', '', 'application/json'), 400, 'VALIDATION_ERROR');

    expect(rateLimitHeaders(await echo(app)).reset).toBe('500');
  });

  test('HTTP-05 HTTP-31: EX-H14 a set-now body of 1 MiB + 1 byte returns 413 and keeps the clock', async () => {
    const app = await appWithOneAllowedEcho();
    await setNow(app, { now: 500 });

    const payload = paddedJson({ now: 900 }, ONE_MIB + 1);

    expectError(await postRaw(app, '/api/test/set-now', payload, 'application/json'), 413, 'PAYLOAD_TOO_LARGE');
    expect(rateLimitHeaders(await echo(app)).reset).toBe('500');
  });

  test('ALG-15 HTTP-32: EX-H10 set-now may move the clock backwards', async () => {
    const app = await appWithOneAllowedEcho();
    await setNow(app, { now: 500 });

    await setNow(app, { now: 200 });

    expect(rateLimitHeaders(await echo(app))).toMatchObject({ reset: '800', retryAfter: '1' });
  });

  test('HTTP-32: set-now is accepted before any reset', async () => {
    const app = buildApp();

    const res = await setNow(app, { now: 400 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true });
  });
});

describe('test endpoints in general', () => {
  test('HTTP-06: EX-H12 before the first reset every key is unknown', async () => {
    const app = buildApp();

    expectError(await echo(app), 401, 'INVALID_API_KEY');
  });

  test('HTTP-06: app instances share no state', async () => {
    const first = await appWith([K1_SINGLE]);
    await echo(first);
    await reset(first, { now: 0, keys: [K1_SINGLE] });
    await echo(first);

    const second = buildApp();

    expectError(await echo(second), 401, 'INVALID_API_KEY');
    expectError(await echo(first), 429, 'RATE_LIMITED');
  });

  test('HTTP-23: EX-H13 test endpoints need no key and carry no rate-limit headers', async () => {
    const app = await appWith();

    const res = await setNow(app, { now: 0 });
    const resetRes = await reset(app, { now: 0, keys: [K1] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ ok: true });
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(resetRes.headers['content-type']).toBe('application/json; charset=utf-8');
    expectNoRateLimitHeaders(res);
    expectNoRateLimitHeaders(resetRes);
    expect(rateLimitHeaders(await echo(app)).remaining).toBe('2');
  });
});
