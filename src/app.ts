import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { ManualClock } from './clock.js';
import { errorBody, type ErrorCode } from './errors.js';
import { SlidingWindowLimiter } from './limiter.js';
import { parseResetBody, parseSetNowBody } from './validation.js';

export interface AppOptions {
  logger?: boolean;
}

function sendError(reply: FastifyReply, status: number, code: ErrorCode): FastifyReply {
  return reply.code(status).send(errorBody(code));
}

/**
 * The X-Api-Key value with surrounding spaces and tabs removed (HTTP-11). Node already trims on real
 * sockets and joins repeated headers with ", "; `inject()` does neither, so both are done here.
 */
function apiKeyOf(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join(', ') : (header ?? '');
  return value.replace(/^[ \t]+|[ \t]+$/g, '');
}

/**
 * The first `x` query value, decoded by the WHATWG form-urlencoded parser (HTTP-14). Fastify's own parser
 * leaves the whole value undecoded when any escape in it is invalid.
 */
function queryX(url: string): string | null {
  const start = url.indexOf('?');
  return start === -1 ? null : new URLSearchParams(url.slice(start + 1)).get('x');
}

function statusCodeOf(error: unknown): number {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : 500;
}

/** Parses every request body as JSON and ignores the Content-Type header completely (HTTP-05). */
function registerJsonBodyParser(app: FastifyInstance): void {
  // Fastify rejects an empty or malformed Content-Type before any parser runs, so drop the header.
  app.addHook('onRequest', async (request) => {
    delete request.raw.headers['content-type'];
  });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Malformed JSON body'), { statusCode: 400 }), undefined);
    }
  });
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  // All state belongs to this app instance (HTTP-06).
  const clock = new ManualClock();
  const limiter = new SlidingWindowLimiter();

  const app = Fastify({
    logger: options.logger ?? false,
    // HEAD would otherwise run the GET handler and count against the limit (HTTP-04).
    exposeHeadRoutes: false,
    // Requests arriving during close() would otherwise get Fastify's own 503 body (HTTP-02).
    return503OnClosing: false,
    // Malformed paths such as /api/%ZZ are reported here, not to the error handler (HTTP-04).
    frameworkErrors: (_error, _request, reply) => {
      sendError(reply, 404, 'NOT_FOUND');
    },
  });

  registerJsonBodyParser(app);

  app.setNotFoundHandler((request, reply) =>
    // A HEAD response never has a body; inject() would otherwise return one (HTTP-04).
    request.method === 'HEAD' ? reply.code(404).send() : sendError(reply, 404, 'NOT_FOUND'),
  );

  app.setErrorHandler((error, request, reply) => {
    // The body is parsed before the not-found handler runs; the route still wins (HTTP-04).
    if (request.is404) return sendError(reply, 404, 'NOT_FOUND');
    const status = statusCodeOf(error);
    if (status === 413) return sendError(reply, 413, 'PAYLOAD_TOO_LARGE');
    if (status >= 400 && status < 500) return sendError(reply, 400, 'VALIDATION_ERROR');
    request.log.error(error);
    return sendError(reply, 500, 'INTERNAL_ERROR');
  });

  // Test endpoints: no API key, no rate limiting (HTTP-23).
  app.post('/api/test/reset', async (request, reply) => {
    const body = parseResetBody(request.body);
    if (body === null) return sendError(reply, 400, 'VALIDATION_ERROR');
    limiter.configure(body.keys);
    clock.set(body.now);
    return { ok: true };
  });

  app.post('/api/test/set-now', async (request, reply) => {
    const body = parseSetNowBody(request.body);
    if (body === null) return sendError(reply, 400, 'VALIDATION_ERROR');
    clock.set(body.now);
    return { ok: true };
  });

  // Gateway route: authentication → rate limiting → upstream echo (HTTP-10).
  app.get('/api/echo', async (request, reply) => {
    const apiKey = apiKeyOf(request.headers['x-api-key']);
    if (apiKey === '') return sendError(reply, 401, 'MISSING_API_KEY');

    const decision = limiter.evaluate(apiKey, clock.now());
    if (decision === null) return sendError(reply, 401, 'INVALID_API_KEY');

    reply.headers({
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': String(decision.remaining),
      'X-RateLimit-Reset': String(decision.resetMs),
    });
    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSec));
      return sendError(reply, 429, 'RATE_LIMITED');
    }

    const x = queryX(request.url);
    return x === null ? {} : { x };
  });

  return app;
}
