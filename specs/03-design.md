# 03 — Technical Design

| | |
|---|---|
| Status | Approved |
| Implements | `specs/01-rate-limit-algorithm.md`, `specs/02-http-contract.md` |
| Stack | Node.js ≥ 20, TypeScript (strict, ESM), Fastify 5, Vitest |

## 1. Overview

```text
HTTP request
    │
    ▼
Fastify app (src/app.ts) ──── not found / error handlers → {"error":{"code":...}}
    │
    ├── POST /api/test/reset ──► validation.ts ──► limiter.configure() + clock.set()
    ├── POST /api/test/set-now ► validation.ts ──► clock.set()
    └── GET /api/echo
          1. auth: X-Api-Key present? configured?        (HTTP-11)
          2. limiter.evaluate(apiKey, clock.now())        (ALG-04..ALG-14)
             → X-RateLimit-* headers, 429 + Retry-After   (HTTP-12, HTTP-13)
          3. upstream echo: 200 {x} or 200 {}             (HTTP-14, HTTP-15)
```

The domain logic (`limiter.ts`, `clock.ts`, `validation.ts`) has no Fastify imports and is unit-tested
directly. `app.ts` is the only module that knows about HTTP. All state lives in one app instance, so every
test builds its own isolated app.

## 2. File structure

```text
src/
  clock.ts        ManualClock — the gateway clock (ALG-01)
  limiter.ts      SlidingWindowLimiter — configs, logs, decisions (ALG-03..ALG-15)
  validation.ts   Body parsers for the test endpoints (ALG-02, HTTP-20, HTTP-30)
  errors.ts       Error codes and the error body shape (HTTP-02, HTTP-03)
  app.ts          buildApp(): routes, auth, headers, error and not-found handlers
  server.ts       Process entry point: PORT/HOST, listen, graceful shutdown
tests/
  unit/           limiter, clock, validation
  http/           app.inject() tests per endpoint and for errors
  e2e/            one real-socket smoke test
```

## 3. Modules and interfaces

### `clock.ts`

```ts
export class ManualClock {
  now(): number;            // initial value 0 (ALG-01, HTTP-06)
  set(now: number): void;   // any valid integer, also backwards (ALG-15)
}
```

### `limiter.ts`

```ts
export interface KeyConfig {
  apiKey: string;
  limit: number;
  windowMs: number;
  burst: number;
}

export type Decision =
  | { allowed: true;  limit: number; remaining: number; resetMs: number }
  | { allowed: false; limit: number; remaining: 0;      resetMs: number; retryAfterSec: number };

export class SlidingWindowLimiter {
  configure(keys: readonly KeyConfig[]): void;              // ALG-03
  isConfigured(apiKey: string): boolean;                    // ALG-10
  evaluate(apiKey: string, now: number): Decision | null;   // null = unknown key (ALG-10)
}
```

- State: `Map<string, KeyConfig>` and `Map<string, number[]>` (the logs).
- `configure` builds both maps from scratch, so old keys and logs disappear (ALG-03).
- `evaluate` follows ALG-04 → ALG-07 literally: filter the log to `t > now − windowMs`, compare its length
  with `limit + burst`, append `now` if allowed, then compute the figures (ALG-11 → ALG-14).
- `oldest` is the minimum of the log, not its first element, because with a clock moved backwards the log
  is not sorted (ALG-15). A log holds at most `limit + burst` entries, so a linear scan is fine.
- The limiter receives `now` as an argument and never reads a clock itself, which keeps it a pure,
  deterministic unit.

### `validation.ts`

```ts
export function parseResetBody(body: unknown): { now: number; keys: KeyConfig[] } | null;
export function parseSetNowBody(body: unknown): { now: number } | null;
```

- Return `null` for any violation of HTTP-05/HTTP-20/HTTP-30; the caller turns that into 400.
- Integer check: `typeof v === 'number' && Number.isSafeInteger(v)` plus the bounds from ALG-02
  (`MAX = 2^52 − 1`). Values are checked by JSON type; strings, booleans, `null` and arrays are never
  coerced.
- `apiKey` check: `/^[\x20-\x2B\x2D-\x7E]+$/` (printable ASCII without a comma) and no leading or
  trailing space.
- Unknown fields are ignored at the top level and in each key config; the returned objects contain only
  the known fields, so keys such as `__proto__` are never copied.

### `errors.ts`

```ts
export type ErrorCode =
  | 'VALIDATION_ERROR' | 'MISSING_API_KEY' | 'INVALID_API_KEY'
  | 'NOT_FOUND' | 'PAYLOAD_TOO_LARGE' | 'RATE_LIMITED' | 'INTERNAL_ERROR';

export function errorBody(code: ErrorCode): { error: { code: ErrorCode } };
```

### `app.ts`

```ts
export interface AppOptions { logger?: boolean }
export function buildApp(options?: AppOptions): FastifyInstance;
```

Fastify settings and handlers that the contract depends on:

| Concern | Setting | Why |
|---|---|---|
| `HEAD /api/echo` must be 404 | `exposeHeadRoutes: false` | Fastify adds HEAD routes for GET by default, which would also run the limiter (HTTP-04). |
| Body is JSON whatever the `Content-Type` | An `onRequest` hook deletes the `Content-Type` request header, then `removeAllContentTypeParsers()` + one catch-all `'*'` parser (`parseAs: 'string'`) runs `JSON.parse`; an empty body becomes `undefined` | HTTP-05. Fastify otherwise accepts only `application/json`, parses `text/plain` as a string and answers 415 for the rest; it also rejects an empty or malformed header (`json`) before any parser runs, hence the hook. A body sent with no `Content-Type` still reaches the parser. |
| Body size | Fastify's default `bodyLimit` (1 MiB) | Its `FST_ERR_CTP_BODY_TOO_LARGE` error is mapped to 413 (HTTP-05). |
| Unknown routes | `setNotFoundHandler` → 404 `NOT_FOUND` | Replaces Fastify's default 404 body (HTTP-02, HTTP-04). |
| Route matched before body errors | In `setErrorHandler`, `request.is404` → 404 `NOT_FOUND` | Fastify parses the body before it calls the not-found handler, so a malformed body on an unknown route would otherwise surface as a parse error (HTTP-04). |
| Error mapping | `setErrorHandler`: 404 route → `NOT_FOUND`; status 413 → `PAYLOAD_TOO_LARGE`; any other 4xx (malformed JSON) → 400 `VALIDATION_ERROR`; anything else → 500 `INTERNAL_ERROR` | Replaces Fastify's default error bodies (HTTP-02, HTTP-03). |
| Malformed path (`/api/%ZZ`) | `frameworkErrors` option → 404 `NOT_FOUND` | Fastify reports `FST_ERR_BAD_URL` through `frameworkErrors`, not through `setErrorHandler` (HTTP-04). |
| Reading `x` | The handler parses the raw query string with `URLSearchParams` and uses `get('x')` (first value, `null` = missing) | HTTP-14. Fastify's default query parser returns the raw value when any escape in it is invalid (`a%20b%ZZ` stays undecoded). |
| Shutdown | `return503OnClosing: false` | Fastify would otherwise answer requests that arrive during `close()` with its own 503 body (HTTP-02). |
| Response bodies | `reply.send(object)` → `application/json; charset=utf-8` | HTTP-01 |

Echo handler outline:

```ts
const apiKey = trimSpacesAndTabs(request.headers['x-api-key'] ?? '');
if (apiKey === '') → 401 MISSING_API_KEY
const decision = limiter.evaluate(apiKey, clock.now());
if (decision === null) → 401 INVALID_API_KEY
set X-RateLimit-Limit / -Remaining / -Reset from decision
if (!decision.allowed) → 429 RATE_LIMITED + Retry-After
const x = new URLSearchParams(rawQueryString).get('x')
→ 200 x === null ? {} : { x }
```

The header value is trimmed in code although Node already trims it on real sockets, because
`app.inject()` (used by the tests) passes it through unchanged. If the same header is sent several times,
Node joins the values with `", "`; a configured key never contains a comma (ALG-02), so the joined value is
rejected as `INVALID_API_KEY` without special code.

### `server.ts`

- `PORT` (default `3000`; an empty value also means the default) and `HOST` (default `127.0.0.1`) from the
  environment.
- `buildApp({ logger: true })`, `listen`, and `close()` on `SIGINT`/`SIGTERM`.

## 4. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest, direct calls | `ALG-*` examples EX-01..EX-10, validation rules |
| HTTP | Vitest + `app.inject()` | `HTTP-*` examples EX-H01..EX-H11, error paths, headers |
| E2E | Vitest + real socket (`listen({ port: 0 })` + `fetch`) | the EX-H01 flow over a real connection |

- Every test name starts with the requirement ID(s) it verifies, e.g. `ALG-04: ...`.
- Each test builds its own app or limiter, so tests are independent and can run in any order.
- Time is controlled only through `set-now` / `reset` (or the `now` argument in unit tests); no test
  sleeps or reads the system clock.

## 5. Decisions

| ID | Decision | Alternatives considered |
|---|---|---|
| T1 | Hand-written validation instead of Fastify JSON schemas | Fastify's Ajv setup coerces types by default (`"5"` → `5`) and has its own error body format; switching both off costs more than ~40 lines of explicit checks. |
| T2 | Logs as plain arrays, pruned on every evaluation (O(log size) per request) | A sorted deque with binary insertion: not needed for this toy, a log never exceeds `limit + burst` entries; very large capacities would make each request slower. |
| T3 | One app instance owns its clock and limiter | Module-level singletons would leak state between tests. |
| T4 | 404 for every undefined method/path, including HEAD and OPTIONS | 405 with `Allow`: not required by the contract and adds a second error path. |
| T5 | Plain `JSON.parse` for bodies instead of Fastify's `secure-json-parse` | The contract ignores unknown fields, including `__proto__`; validation copies only known fields, so prototype pollution cannot happen. Fastify's parser would reject such bodies with 400, which the contract does not allow. |
| T6 | Fastify as the HTTP framework | Express would work equally well: neither framework matches the contract out of the box (both answer `HEAD` through `GET` routes, both send non-JSON 404 and error bodies by default, both need a custom parser to ignore `Content-Type`). Fastify was chosen for `inject()`, which runs HTTP tests without opening a port or adding `supertest`, for its built-in TypeScript types, and for JSON replies by default. Specs 01 and 02 do not depend on the framework; switching would change only `src/app.ts` and the test helpers. |
