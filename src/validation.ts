import type { KeyConfig } from './limiter.js';

/** Largest accepted value; keeps every derived figure an exact integer (ALG-02, D11). */
export const MAX_VALUE = 2 ** 52 - 1;

/** Printable ASCII without a comma (ALG-02, D12). */
const API_KEY_CHARS = /^[\x20-\x2B\x2D-\x7E]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON number whose value is a whole number in [min, MAX_VALUE]; never coerced from other types. */
function isInteger(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= MAX_VALUE;
}

function isApiKey(value: unknown): value is string {
  return typeof value === 'string' && API_KEY_CHARS.test(value) && !value.startsWith(' ') && !value.endsWith(' ');
}

function parseKeyConfig(value: unknown): KeyConfig | null {
  if (!isObject(value)) return null;
  const { apiKey, limit, windowMs, burst } = value;
  if (!isApiKey(apiKey) || !isInteger(limit, 0) || !isInteger(burst, 0) || !isInteger(windowMs, 1)) return null;
  if (limit + burst < 1) return null;
  return { apiKey, limit, windowMs, burst };
}

/** Body of `POST /api/test/reset` (HTTP-20); `null` if invalid. Only known fields are returned. */
export function parseResetBody(body: unknown): { now: number; keys: KeyConfig[] } | null {
  if (!isObject(body) || !isInteger(body.now, 0) || !Array.isArray(body.keys)) return null;

  const keys: KeyConfig[] = [];
  const seen = new Set<string>();
  for (const item of body.keys) {
    const key = parseKeyConfig(item);
    if (key === null || seen.has(key.apiKey)) return null;
    seen.add(key.apiKey);
    keys.push(key);
  }
  return { now: body.now, keys };
}

/** Body of `POST /api/test/set-now` (HTTP-30); `null` if invalid. */
export function parseSetNowBody(body: unknown): { now: number } | null {
  if (!isObject(body) || !isInteger(body.now, 0)) return null;
  return { now: body.now };
}
