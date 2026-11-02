import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../../src/app.js';

export interface KeyConfigBody {
  apiKey: string;
  limit: number;
  windowMs: number;
  burst: number;
}

/** The fixture key of spec 02 §4: capacity 3. */
export const K1: KeyConfigBody = { apiKey: 'k1', limit: 2, windowMs: 1000, burst: 1 };

/** k1 with capacity 1, used by several examples. */
export const K1_SINGLE: KeyConfigBody = { apiKey: 'k1', limit: 1, windowMs: 1000, burst: 0 };

export function reset(app: FastifyInstance, body: unknown): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: '/api/test/reset', payload: body as object });
}

export function setNow(app: FastifyInstance, body: unknown): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: '/api/test/set-now', payload: body as object });
}

/** Sends a raw string body with an explicit (or no) Content-Type. */
export function postRaw(
  app: FastifyInstance,
  url: string,
  payload: string,
  contentType?: string,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url,
    payload,
    headers: contentType === undefined ? {} : { 'content-type': contentType },
  });
}

/** Builds an app and applies the fixture reset (spec 02 §4) with the given keys. */
export async function appWith(keys: KeyConfigBody[] = [K1], now = 0): Promise<FastifyInstance> {
  const app = buildApp();
  const res = await reset(app, { now, keys });
  expect(res.statusCode).toBe(200);
  return app;
}

/** `GET /api/echo<query>`; `key: null` sends no X-Api-Key header. */
export function echo(
  app: FastifyInstance,
  { key = 'k1', query = '?x=a' }: { key?: string | string[] | null; query?: string } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'GET',
    url: `/api/echo${query}`,
    headers: key === null ? {} : { 'x-api-key': key },
  });
}

export interface RateLimitHeaders {
  limit: string | undefined;
  remaining: string | undefined;
  reset: string | undefined;
  retryAfter: string | undefined;
}

export function rateLimitHeaders(res: LightMyRequestResponse): RateLimitHeaders {
  const header = (name: string): string | undefined => {
    const value = res.headers[name];
    return Array.isArray(value) ? value.join(',') : value?.toString();
  };
  return {
    limit: header('x-ratelimit-limit'),
    remaining: header('x-ratelimit-remaining'),
    reset: header('x-ratelimit-reset'),
    retryAfter: header('retry-after'),
  };
}

export function expectNoRateLimitHeaders(res: LightMyRequestResponse): void {
  expect(rateLimitHeaders(res)).toEqual({
    limit: undefined,
    remaining: undefined,
    reset: undefined,
    retryAfter: undefined,
  });
}

export function expectError(res: LightMyRequestResponse, status: number, code: string): void {
  expect(res.statusCode).toBe(status);
  expect(res.json()).toStrictEqual({ error: { code } });
  expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
}

export const ONE_MIB = 1024 * 1024;

/** JSON text of `body` plus an unknown `padding` field, exactly `size` bytes long. */
export function paddedJson(body: Record<string, unknown>, size: number): string {
  const base = JSON.stringify({ ...body, padding: '' });
  const text = JSON.stringify({ ...body, padding: 'x'.repeat(size - Buffer.byteLength(base)) });
  expect(Buffer.byteLength(text)).toBe(size);
  return text;
}
