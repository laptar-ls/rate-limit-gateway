import { describe, expect, test } from 'vitest';
import { parseResetBody, parseSetNowBody } from '../../src/validation.js';

const MAX = 2 ** 52 - 1;
const validKey = { apiKey: 'k1', limit: 1, windowMs: 1000, burst: 0 };

function resetWithKey(overrides: Record<string, unknown>, omit?: string): unknown {
  const keyConfig: Record<string, unknown> = { ...validKey, ...overrides };
  if (omit !== undefined) delete keyConfig[omit];
  return { now: 0, keys: [keyConfig] };
}

describe('parseResetBody', () => {
  test('HTTP-20: accepts a valid body and returns only known fields', () => {
    const body = { now: 5, keys: [{ ...validKey, tier: 'gold' }], extra: true };

    expect(parseResetBody(body)).toEqual({ now: 5, keys: [validKey] });
  });

  test('HTTP-20: accepts an empty keys array', () => {
    expect(parseResetBody({ now: 0, keys: [] })).toEqual({ now: 0, keys: [] });
  });

  test.each([
    ['an array', []],
    ['a string', 'x'],
    ['a number', 5],
    ['a boolean', true],
    ['null', null],
    ['undefined (no body)', undefined],
  ])('HTTP-05: rejects a body that is %s', (_name, body) => {
    expect(parseResetBody(body)).toBeNull();
  });

  test.each([
    ['without now', { keys: [] }],
    ['without keys', { now: 0 }],
    ['with keys as an object', { now: 0, keys: {} }],
    ['with a null key config', { now: 0, keys: [null] }],
    ['with a string key config', { now: 0, keys: ['k1'] }],
  ])('HTTP-20: rejects a body %s', (_name, body) => {
    expect(parseResetBody(body)).toBeNull();
  });

  test.each([
    ['-1', -1],
    ['1.5', 1.5],
    ['"5000"', '5000'],
    ['null', null],
    ['true', true],
    ['[5000]', [5000]],
    ['2^52', MAX + 1],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('ALG-02 HTTP-20: rejects now = %s', (_name, now) => {
    expect(parseResetBody({ now, keys: [] })).toBeNull();
  });

  test.each([
    ['0', 0],
    ['2^52 - 1', MAX],
  ])('ALG-02 HTTP-20: accepts now = %s', (_name, now) => {
    expect(parseResetBody({ now, keys: [] })).toEqual({ now, keys: [] });
  });

  test.each([
    ['apiKey ""', { apiKey: '' }],
    ['apiKey with a leading space', { apiKey: ' k1' }],
    ['apiKey with a trailing space', { apiKey: 'k1 ' }],
    ['apiKey with a comma', { apiKey: 'a,b' }],
    ['non-ASCII apiKey', { apiKey: 'ключ' }],
    ['apiKey with a tab', { apiKey: 'k\t1' }],
    ['apiKey with a newline', { apiKey: 'k1\n' }],
    ['numeric apiKey', { apiKey: 7 }],
    ['limit -1', { limit: -1 }],
    ['limit 1.5', { limit: 1.5 }],
    ['limit "1"', { limit: '1' }],
    ['limit 2^52', { limit: MAX + 1 }],
    ['limit 0 and burst 0', { limit: 0, burst: 0 }],
    ['windowMs 0', { windowMs: 0 }],
    ['windowMs 2^52', { windowMs: MAX + 1 }],
    ['burst -1', { burst: -1 }],
    ['burst null', { burst: null }],
  ])('ALG-02 HTTP-20: rejects a key config with %s', (_name, overrides) => {
    expect(parseResetBody(resetWithKey(overrides))).toBeNull();
  });

  test.each(['apiKey', 'limit', 'windowMs', 'burst'])('HTTP-20: rejects a key config without %s', (field) => {
    expect(parseResetBody(resetWithKey({}, field))).toBeNull();
  });

  test.each([
    ['limit 0 with burst 2', { limit: 0, burst: 2 }],
    ['a space inside the apiKey', { apiKey: 'k 1' }],
    ['printable ASCII apiKey', { apiKey: '!~A-z_0.9' }],
    ['the largest values', { limit: MAX, burst: MAX, windowMs: MAX }],
  ])('ALG-02 HTTP-20: accepts a key config with %s', (_name, overrides) => {
    const body = resetWithKey(overrides);

    expect(parseResetBody(body)).toEqual(body);
  });

  test('HTTP-20: rejects duplicate apiKey values', () => {
    expect(parseResetBody({ now: 0, keys: [validKey, { ...validKey, limit: 5 }] })).toBeNull();
  });
});

describe('parseSetNowBody', () => {
  test('HTTP-30: accepts a valid body and ignores unknown fields', () => {
    expect(parseSetNowBody({ now: 1000, extra: 'x' })).toEqual({ now: 1000 });
  });

  test.each([
    ['{}', {}],
    ['now -1', { now: -1 }],
    ['now "900"', { now: '900' }],
    ['now 1.5', { now: 1.5 }],
    ['now null', { now: null }],
    ['now 2^52', { now: MAX + 1 }],
    ['an array', []],
    ['null', null],
    ['undefined (no body)', undefined],
  ])('HTTP-05 HTTP-30: rejects %s', (_name, body) => {
    expect(parseSetNowBody(body)).toBeNull();
  });
});
