# rate-limit-gateway

A toy HTTP gateway that rate-limits requests per API key with a **sliding window log** plus **burst
capacity**, built spec-first for the task in [`docs/requirements.md`](docs/requirements.md).

## Quick start

Requires Node.js ≥ 20.

```bash
npm install
npm test                    # 190 tests: unit, HTTP (inject) and one real-socket e2e suite
npm run build && npm start  # http://127.0.0.1:3000  (override with PORT / HOST)
npm run dev                 # watch mode
```

```bash
curl -X POST localhost:3000/api/test/reset -H 'Content-Type: application/json' \
  -d '{"now":0,"keys":[{"apiKey":"demo","limit":2,"windowMs":1000,"burst":1}]}'
curl -i 'localhost:3000/api/echo?x=hello' -H 'X-Api-Key: demo'   # 200, X-RateLimit-Remaining: 2
curl -X POST localhost:3000/api/test/set-now -H 'Content-Type: application/json' -d '{"now":1000}'
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/echo?x=…` + `X-Api-Key` | Rate-limited upstream route; returns `{ "x": "…" }`. Sends `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (ms); on 429 also `Retry-After` (s) and `{"error":{"code":"RATE_LIMITED"}}`. |
| `POST /api/test/reset` | `{ now, keys: [{ apiKey, limit, windowMs, burst }] }` — replaces all keys, empties all logs, sets the clock. |
| `POST /api/test/set-now` | `{ now }` — sets the clock the limiter uses (it never reads the system clock). |

The full contract, including every error code, is in [`specs/02-http-contract.md`](specs/02-http-contract.md).

## Key decisions

The task text contains three conflicting admission rules. The specs adopt the one marked
**"Canonical rule for tests"**: allow if `count < limit + burst`, so burst is extra capacity in the window
([spec 01, D1](specs/01-rate-limit-algorithm.md#3-decisions-on-the-source-text)). Every other gap the task
leaves open is decided explicitly in the decision tables of the two specs, for example:

- `Remaining` and `Reset` are computed after the current request is recorded; denied requests are not
  recorded (D3–D5).
- A timestamp exactly `T − windowMs` has left the window (D2).
- Missing or unknown `X-Api-Key` → 401 `MISSING_API_KEY` / `INVALID_API_KEY`, not counted (H1, H2).
- A missing `x` returns 200 `{}` (H4); request bodies are parsed as JSON whatever the `Content-Type` (H9).

## Repository layout

```text
docs/requirements.md     original task (unchanged)
docs/reflection.md       reflection: AI vs specs
specs/01-…, 02-…         the two authored specs (requirement IDs ALG-*, HTTP-*, Given/When/Then examples)
specs/03-design.md       technical design
specs/tasks.md           implementation tasks
src/                     clock, limiter, validation, errors, Fastify app, server entry point
tests/unit|http|e2e/     every test name starts with the requirement ID(s) it verifies
CLAUDE.md                rules for the AI assistant working in this repo
```

## How it was built

Spec-first, in this order: task → specs → design and tasks → failing tests → implementation, one task at a
time. The work was done with Claude Code (AI). The specs were reviewed by independent AI reviewers before
any code existed; [`docs/reflection.md`](docs/reflection.md) summarises what the reviews and a no-spec
baseline experiment showed.

## Traceability

Every requirement in the specs has at least one test that cites it by ID.

| Requirement | Tests | Files |
|---|---|---|
| ALG-01 Clock source | 4 | `unit/clock`, `http/echo` |
| ALG-02 Valid values | 34 | `unit/limiter`, `unit/validation`, `http/test-endpoints` |
| ALG-03 Reconfiguration | 3 | `unit/limiter`, `http/test-endpoints` |
| ALG-04 Pruning | 4 | `unit/limiter` |
| ALG-05 Count | 1 | `unit/limiter` |
| ALG-06 Admission | 3 | `unit/limiter` |
| ALG-07 Recording | 1 | `unit/limiter` |
| ALG-08 Same timestamp | 1 | `unit/limiter` |
| ALG-09 Key isolation | 2 | `unit/limiter`, `http/echo` |
| ALG-10 Unknown key | 1 | `unit/limiter` |
| ALG-11 Limit | 4 | `unit/limiter` |
| ALG-12 Remaining | 2 | `unit/limiter` |
| ALG-13 Reset | 5 | `unit/limiter` |
| ALG-14 Retry after (denied only) | 5 | `unit/limiter` |
| ALG-15 Backwards time | 7 | `unit/clock`, `unit/limiter`, `http/echo`, `http/test-endpoints` |
| HTTP-01 JSON responses | 2 | `http/echo`, `http/errors` |
| HTTP-02 Error body | 10 | `http/errors` |
| HTTP-03 Error codes | 2 | `http/errors` |
| HTTP-04 Unknown routes | 12 | `http/echo`, `http/errors` |
| HTTP-05 JSON request bodies | 37 | `unit/validation`, `http/test-endpoints`, `e2e/server` |
| HTTP-06 Initial state | 3 | `unit/clock`, `http/test-endpoints` |
| HTTP-10 Processing order | 2 | `http/echo` |
| HTTP-11 Authentication | 9 | `http/echo`, `e2e/server` |
| HTTP-12 Rate-limit headers | 3 | `http/echo`, `e2e/server` |
| HTTP-13 Denied | 2 | `http/echo`, `e2e/server` |
| HTTP-14 Echo | 13 | `http/echo`, `e2e/server` |
| HTTP-15 Missing `x` | 12 | `http/echo` |
| HTTP-20 Reset body | 72 | `unit/validation`, `http/test-endpoints` |
| HTTP-21 Invalid reset body | 34 | `http/test-endpoints` |
| HTTP-22 Reset effect | 3 | `http/test-endpoints` |
| HTTP-23 No gateway rules on test endpoints | 1 | `http/test-endpoints` |
| HTTP-30 Set-now body | 15 | `unit/validation`, `http/test-endpoints` |
| HTTP-31 Invalid set-now body | 7 | `http/test-endpoints` |
| HTTP-32 Set-now effect | 5 | `http/echo`, `http/test-endpoints` |
