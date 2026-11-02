import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/app.js';

let app: FastifyInstance;
let baseUrl: string;

/** Sends a raw HTTP/1.1 request, so headers can be written exactly as on the wire. */
function rawRequest(lines: string[], body = ''): Promise<string> {
  const { port } = app.server.address() as net.AddressInfo;
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write([...lines, 'Connection: close', '', body].join('\r\n'));
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString()));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

describe('real HTTP server', () => {
  beforeAll(async () => {
    app = buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as net.AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  test('HTTP-05 HTTP-12 HTTP-13 HTTP-14: EX-H01 flow over a real connection, body sent by fetch as text/plain', async () => {
    const resetRes = await fetch(`${baseUrl}/api/test/reset`, {
      method: 'POST',
      body: JSON.stringify({ now: 0, keys: [{ apiKey: 'k1', limit: 2, windowMs: 1000, burst: 1 }] }),
    });
    expect(resetRes.status).toBe(200);
    expect(await resetRes.json()).toStrictEqual({ ok: true });

    const results = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/api/echo?x=hello`, { headers: { 'X-Api-Key': 'k1' } });
      results.push({
        status: res.status,
        body: await res.json(),
        limit: res.headers.get('x-ratelimit-limit'),
        remaining: res.headers.get('x-ratelimit-remaining'),
        reset: res.headers.get('x-ratelimit-reset'),
        retryAfter: res.headers.get('retry-after'),
      });
    }

    expect(results).toEqual([
      { status: 200, body: { x: 'hello' }, limit: '3', remaining: '2', reset: '1000', retryAfter: null },
      { status: 200, body: { x: 'hello' }, limit: '3', remaining: '1', reset: '1000', retryAfter: null },
      { status: 200, body: { x: 'hello' }, limit: '3', remaining: '0', reset: '1000', retryAfter: null },
      {
        status: 429,
        body: { error: { code: 'RATE_LIMITED' } },
        limit: '3',
        remaining: '0',
        reset: '1000',
        retryAfter: '1',
      },
    ]);
  });

  test.each([
    ['no Content-Type', []],
    ['an empty Content-Type', ['Content-Type:']],
    ['a malformed Content-Type', ['Content-Type: json']],
  ])('HTTP-05: EX-H08 a reset body with %s is parsed as JSON on a real socket', async (_name, contentType) => {
    const body = JSON.stringify({ now: 0, keys: [{ apiKey: 'k1', limit: 1, windowMs: 1000, burst: 0 }] });

    const response = await rawRequest(
      ['POST /api/test/reset HTTP/1.1', 'Host: localhost', ...contentType, `Content-Length: ${Buffer.byteLength(body)}`],
      body,
    );

    expect(response).toMatch(/^HTTP\/1\.1 200 /);
    expect(response).toContain('{"ok":true}');
  });

  test('HTTP-11: EX-H02 EX-H03 header whitespace and repeated headers on a real socket', async () => {
    await fetch(`${baseUrl}/api/test/reset`, {
      method: 'POST',
      body: JSON.stringify({ now: 0, keys: [{ apiKey: 'k1', limit: 5, windowMs: 1000, burst: 0 }] }),
    });

    const spaced = await rawRequest(['GET /api/echo?x=a HTTP/1.1', 'Host: localhost', 'X-Api-Key:    k1   ']);
    const blank = await rawRequest(['GET /api/echo?x=a HTTP/1.1', 'Host: localhost', 'X-Api-Key:    ']);
    const repeated = await rawRequest([
      'GET /api/echo?x=a HTTP/1.1',
      'Host: localhost',
      'X-Api-Key: k1',
      'X-Api-Key: k1',
    ]);

    expect(spaced).toMatch(/^HTTP\/1\.1 200 /);
    expect(blank).toMatch(/^HTTP\/1\.1 401 /);
    expect(blank).toContain('{"error":{"code":"MISSING_API_KEY"}}');
    expect(repeated).toMatch(/^HTTP\/1\.1 401 /);
    expect(repeated).toContain('{"error":{"code":"INVALID_API_KEY"}}');
  });
});
