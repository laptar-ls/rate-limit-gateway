# Spec 02 — HTTP Contract

| | |
|---|---|
| Status | Approved |
| Source | `docs/requirements.md`, sections "Domain" (headers, 429 body) and "HTTP" |
| Depends on | `specs/01-rate-limit-algorithm.md` (`ALG-*` rules and figures) |

## 1. Purpose

This spec defines the observable HTTP behaviour of the gateway: endpoints, request formats, status
codes, headers and bodies. The decision logic and the figures it reports come from spec 01; this spec
only states how they appear on the wire.

## 2. Decisions on the source text

The source names the endpoints, the 429 body and the rate-limit headers, but leaves the following open.

| ID | Question | Decision and reason | Requirement |
|---|---|---|---|
| H1 | Missing or empty `X-Api-Key`? | 401 `MISSING_API_KEY`. Not counted, no rate-limit headers: there is no key to count against. | HTTP-11 |
| H2 | Unknown API key? | 401 `INVALID_API_KEY`. The credential is not recognised (401), as opposed to recognised but not permitted (403), which this gateway has no notion of. Not counted, no rate-limit headers. | HTTP-11 |
| H3 | Are `X-RateLimit-*` headers also sent on 429? | Yes, on every response produced after the limiter evaluated the request. A denied client needs them most. | HTTP-12 |
| H4 | Missing `x` query parameter? | 200 with body `{}`: the source says the route "returns `{ x }`" and does not make `x` mandatory, and `{ x }` with no `x` serialises to `{}`. The request is counted like any other. | HTTP-15 |
| H5 | `x` given several times? | The first value is used, so the response is always a string. | HTTP-14 |
| H6 | Format of errors other than 429? | Same shape as the 429 body: `{"error":{"code":"..."}}`, nothing else. One shape for every error. | HTTP-02 |
| H7 | What do the test endpoints return? | 200 with `{"ok":true}`. | HTTP-22, HTTP-32 |
| H8 | Invalid body on a test endpoint? | 400 `VALIDATION_ERROR`, and no state changes. A half-applied reset would make test failures hard to read. | HTTP-21, HTTP-31 |
| H9 | Must the body be sent as `application/json`? | No. The body is parsed as JSON whatever `Content-Type` says (or if it is missing). Tools such as `fetch` send `text/plain` by default; rejecting that would only produce confusing test failures. | HTTP-05 |
| H10 | Are the test endpoints authenticated or rate-limited? | No. They are test fixtures, not gateway traffic. | HTTP-23 |
| H11 | Unknown path or method? | 404 `NOT_FOUND`, including `HEAD`/`OPTIONS` and malformed paths. | HTTP-04 |
| H12 | State at process start? | No keys are configured and the clock is 0. | HTTP-06 |

## 3. Requirements

### General

- **HTTP-01 — JSON responses.** Every response that has a body has a JSON body and the header
  `Content-Type: application/json; charset=utf-8`.
- **HTTP-02 — Error body.** Every error response that has a body has exactly the body
  `{"error":{"code":"<CODE>"}}`, with no other fields. This also applies to errors raised by the HTTP
  framework itself (body parsing, malformed paths), but not to requests the Node.js HTTP server rejects
  before routing (see section 5).
- **HTTP-03 — Error codes.** The gateway uses only these error statuses and codes:

  | Status | Code | When |
  |---|---|---|
  | 400 | `VALIDATION_ERROR` | Invalid request body (HTTP-05, HTTP-21, HTTP-31) |
  | 401 | `MISSING_API_KEY` | `X-Api-Key` missing or empty (HTTP-11) |
  | 401 | `INVALID_API_KEY` | `X-Api-Key` is not a configured key (HTTP-11) |
  | 404 | `NOT_FOUND` | Path and method are not defined in this spec (HTTP-04) |
  | 413 | `PAYLOAD_TOO_LARGE` | Request body larger than 1 MiB (HTTP-05) |
  | 429 | `RATE_LIMITED` | The limiter denied the request (HTTP-13) |
  | 500 | `INTERNAL_ERROR` | Any unexpected failure |

- **HTTP-04 — Unknown routes.** Only `GET /api/echo`, `POST /api/test/reset` and `POST /api/test/set-now`
  exist. Paths are case-sensitive and are compared after percent-decoding (RFC 3986 treats `/api/ech%6F` and
  `/api/echo` as the same path); apart from that they must match exactly. Every other request returns 404
  `NOT_FOUND`, and
  nothing is evaluated or counted. This includes another method on a known path (`POST /api/echo`),
  `HEAD` and `OPTIONS` on any path (a `HEAD` response has no body), a trailing slash (`/api/echo/`), a
  different case (`/API/ECHO`), and a path that is not valid percent-encoding (`/api/%ZZ`). The route is
  matched first: an undefined method and path get 404 whatever the headers and body are, even if the body is
  malformed or too large.
- **HTTP-05 — JSON request bodies.** The POST endpoints parse the request body as JSON and ignore the
  `Content-Type` header completely: it may be absent, empty, another media type or malformed (`json`). A missing or empty body, malformed JSON, or a JSON value
  that is not an object (array, string, number, `true`/`false`, `null`) returns 400 `VALIDATION_ERROR`. A
  body larger than 1 MiB (1 048 576 bytes) returns 413 `PAYLOAD_TOO_LARGE`. Unknown fields are ignored,
  both in the body and in each key config object. Values are checked by their JSON type: a string is never
  converted to a number.
- **HTTP-06 — Initial state.** Every gateway instance starts with no keys configured and the clock at 0
  (ALG-01): the process at start-up, and each app instance created in tests. Instances share no state. Until the first successful reset, every echo request with a key returns 401 `INVALID_API_KEY`.

### `GET /api/echo`

- **HTTP-10 — Processing order.** The gateway handles an echo request in three steps, and the first step
  that produces a response ends processing:
  1. authentication (HTTP-11);
  2. rate limiting at the current clock value `T` (HTTP-12, HTTP-13);
  3. the upstream echo route (HTTP-14, HTTP-15).

  So a request without a key gets 401 even when other parts are wrong, and a denied request gets 429 even
  without `x`. Handling a request never changes the clock.
- **HTTP-11 — Authentication.** The API key is the value of the `X-Api-Key` request header (the header
  name is case-insensitive). Leading and trailing spaces and tabs are removed from the value (Node's HTTP
  parser already does this on real connections); the result is compared exactly and case-sensitively with
  the configured `apiKey` values.
  - Header missing, or empty after removing spaces and tabs → 401 `MISSING_API_KEY`.
  - Otherwise, value is not the `apiKey` of a configured key → 401 `INVALID_API_KEY`. If the header is sent
    more than once, the values arrive joined as `"k1, k2"`; that value contains a comma, so it never
    matches a configured key (ALG-02).

  In both cases the limiter is not evaluated (ALG-10) and the response has no `X-RateLimit-*` or
  `Retry-After` headers.
- **HTTP-12 — Rate-limit headers.** Every response produced in step 2 or 3 carries:

  | Header | Value |
  |---|---|
  | `X-RateLimit-Limit` | Limit (ALG-11) |
  | `X-RateLimit-Remaining` | Remaining (ALG-12) |
  | `X-RateLimit-Reset` | Reset in milliseconds (ALG-13) |

  Values are written as base-10 integers without sign, decimals or exponent.
- **HTTP-13 — Denied.** If the limiter denies the request: status 429, body
  `{"error":{"code":"RATE_LIMITED"}}`, header `Retry-After` set to retry after in seconds (ALG-14), and the
  HTTP-12 headers. `Retry-After` appears only on 429 responses.
- **HTTP-14 — Echo.** If the request is allowed and the query has a parameter named exactly `x`
  (case-sensitive): status 200, body `{"x":"<value>"}`. The value is decoded as
  `application/x-www-form-urlencoded` as defined by the WHATWG URL Standard (what `URLSearchParams` does):
  `+` becomes a space, every valid `%XX` sequence is decoded, an invalid escape such as `%ZZ` is kept as it is
  while the rest of the value is still decoded, and bytes that are not valid UTF-8 become U+FFFD. The value
  is always a string (`?x=5` gives `"5"`). `?x=` and `?x` both give `""`. If `x` appears more than once, the first value is used. Other query parameters are ignored.
- **HTTP-15 — Missing `x`.** If the request is allowed and the query has no parameter named `x`: status 200,
  body `{}`, with the HTTP-12 headers. The request is counted like any other allowed request (ALG-07).

### `POST /api/test/reset`

- **HTTP-20 — Body.** `{"now": <integer>, "keys": [<key config>, ...]}`. Each key config is
  `{"apiKey": <string>, "limit": <integer>, "windowMs": <integer>, "burst": <integer>}`. All fields are
  required and must satisfy ALG-02. `keys` is an array and may be empty. `apiKey` values must be unique
  within `keys`.
- **HTTP-21 — Invalid body.** If HTTP-05 or HTTP-20 is violated: 400 `VALIDATION_ERROR` (or 413 for an
  oversized body), and the key configs, logs and clock stay exactly as they were.
- **HTTP-22 — Effect.** Otherwise, as one step: replace the key configs with `keys` and empty all logs
  (ALG-03), and set the clock to `now`. Response: 200 `{"ok":true}`.
- **HTTP-23 — No gateway rules.** `/api/test/*` endpoints require no API key, are not rate-limited and
  carry no `X-RateLimit-*` headers.

### `POST /api/test/set-now`

- **HTTP-30 — Body.** `{"now": <integer>}`, where `now` satisfies ALG-02.
- **HTTP-31 — Invalid body.** If HTTP-05 or HTTP-30 is violated: 400 `VALIDATION_ERROR` (or 413 for an
  oversized body), and the clock stays as it was.
- **HTTP-32 — Effect.** Otherwise set the clock to `now`. `now` may be lower than the current clock value
  (ALG-15). Key configs and logs are not changed. Response: 200 `{"ok":true}`.

## 4. Examples

**Fixture.** Unless an example says otherwise, it starts with
`POST /api/test/reset` `{"now":0,"keys":[{"apiKey":"k1","limit":2,"windowMs":1000,"burst":1}]}`, so `k1`
has capacity 3, its log is empty and the clock is 0. When an example gives `k1` another config, the reset
uses that config instead. Rows of a table are independent and each starts from the fixture, unless the
example says they are sent in sequence. "Echo with `k1`" means `GET /api/echo?x=a` with `X-Api-Key: k1`.

### EX-H01 — Full flow (HTTP-01, HTTP-12, HTTP-13, HTTP-14, HTTP-22, HTTP-32)

Given the fixture (the reset returned 200 `{"ok":true}`)
When `GET /api/echo?x=hello` with `X-Api-Key: k1` is sent four times in sequence
Then the responses are:

| # | Status | Body | `X-RateLimit-Limit` | `X-RateLimit-Remaining` | `X-RateLimit-Reset` | `Retry-After` |
|---|---|---|---|---|---|---|
| 1 | 200 | `{"x":"hello"}` | 3 | 2 | 1000 | — |
| 2 | 200 | `{"x":"hello"}` | 3 | 1 | 1000 | — |
| 3 | 200 | `{"x":"hello"}` | 3 | 0 | 1000 | — |
| 4 | 429 | `{"error":{"code":"RATE_LIMITED"}}` | 3 | 0 | 1000 | 1 |

and every response has `Content-Type: application/json; charset=utf-8`.
When `POST /api/test/set-now` with `{"now":1000}` returns 200 `{"ok":true}`
And `GET /api/echo?x=hello` with `X-Api-Key: k1` is sent
Then the response is 200 `{"x":"hello"}` with remaining 2 and reset 1000.

### EX-H02 — Missing API key (HTTP-11)

When `GET /api/echo?x=a` is sent without `X-Api-Key`, with `X-Api-Key:` (empty) or with `X-Api-Key:` followed
only by spaces
Then the response is 401 `{"error":{"code":"MISSING_API_KEY"}}` without `X-RateLimit-*` headers
And a following echo with `k1` reports remaining 2 (nothing was counted).

### EX-H03 — Unknown API key (HTTP-11)

When `GET /api/echo?x=a` is sent with `X-Api-Key: K1`, or with two `X-Api-Key` headers `k1` and `k1`
(delivered as `"k1, k1"`)
Then the response is 401 `{"error":{"code":"INVALID_API_KEY"}}` without `X-RateLimit-*` headers.
When the request is sent with `X-Api-Key:   k1  ` (surrounding spaces)
Then the response is 200, because the parser removes the spaces.

### EX-H04 — Missing `x` (HTTP-15)

Given `k1` with `limit = 1`, `burst = 0`, `windowMs = 1000`
When `GET /api/echo` with `X-Api-Key: k1` is sent
Then the response is 200 `{}` with `X-RateLimit-Remaining: 0`
And a following echo with `k1` returns 429.

### EX-H05 — Values of `x` (HTTP-14, HTTP-15)

| Query | Status | Body |
|---|---|---|
| `?x=` | 200 | `{"x":""}` |
| `?x` | 200 | `{"x":""}` |
| `?x=a%20b` | 200 | `{"x":"a b"}` |
| `?x=a+b` | 200 | `{"x":"a b"}` |
| `?x=%ZZ` | 200 | `{"x":"%ZZ"}` |
| `?x=a%20b%ZZ` | 200 | `{"x":"a b%ZZ"}` |
| `?x=%C3%28` | 200 | `{"x":"\ufffd("}` |
| `?x=5` | 200 | `{"x":"5"}` |
| `?x=1&x=2` | 200 | `{"x":"1"}` |
| `?X=a` | 200 | `{}` |

### EX-H06 — Processing order (HTTP-10)

Given `k1` with `limit = 1`, `burst = 0`, `windowMs = 1000` and one echo with `k1` already allowed
When `GET /api/echo` (no `x`) with `X-Api-Key: k1` is sent
Then the response is 429 `RATE_LIMITED` with `Retry-After: 1`
When `GET /api/echo` (no `x`) is sent without `X-Api-Key`
Then the response is 401 `MISSING_API_KEY`.

### EX-H07 — Invalid reset keeps the previous state (HTTP-05, HTTP-20, HTTP-21)

Given `k1` with `limit = 1`, `burst = 0`, `windowMs = 1000` and one echo with `k1` already allowed at T = 0
When `POST /api/test/reset` is sent with any body below
Then the response is 400 `{"error":{"code":"VALIDATION_ERROR"}}`
And a following echo with `k1` still returns 429 with `X-RateLimit-Reset: 1000`. (Had the reset been applied,
or had only the clock moved to 5000, that echo would be allowed.)

Each body uses `now: 5000` where it has a `now`, and `K(...)` stands for
`{"apiKey":"k1","limit":1,"windowMs":1000,"burst":0}` with the listed change:

- Body shape: `{"keys":[]}`; `{"now":5000}`; `{"now":5000,"keys":{}}`; `[]`; `"x"`; `null`; empty body;
  `{bad json`.
- `now`: `-1`; `1.5`; `"5000"`; `null`; `true`; `[5000]`; `4503599627370496` (2^52).
- Key config: `K(apiKey: "")`; `K(apiKey: " k1")`; `K(apiKey: "a,b")`; `K(apiKey: "ключ")`; `K(apiKey: 7)`;
  `K(limit: -1)`; `K(limit: 0, burst: 0)`; `K(limit: 1.5)`; `K(limit: "1")`; `K(windowMs: 0)`;
  `K(burst: -1)`; `K` without `burst`; `K` without `apiKey`; the key config is `null`.
- Two key configs with `apiKey: "k1"`.

### EX-H08 — Accepted reset bodies (HTTP-05, HTTP-20, HTTP-22)

Each body below returns 200 `{"ok":true}`:

- `{"now":0,"keys":[]}` — afterwards an echo with `k1` returns 401 `INVALID_API_KEY`.
- `{"now":1.0,"keys":[{"apiKey":"k 1","limit":1e3,"windowMs":1000,"burst":0,"tier":"gold"}],"extra":true}`
  (integer values written as `1.0` and `1e3`, unknown fields, a space inside the key) — afterwards an echo
  with `X-Api-Key: k 1` returns 200 with `X-RateLimit-Limit: 1000`.
- `{"now":0,"keys":[{"apiKey":"b","limit":0,"windowMs":1000,"burst":2}]}` — afterwards an echo with `b`
  returns 200 with `X-RateLimit-Limit: 2`.
- The fixture body sent with `Content-Type: text/plain`, an empty `Content-Type`, `Content-Type: json`, or no
  `Content-Type` — it is parsed as JSON.
- The fixture body padded with an unknown field to exactly 1 MiB (1 048 576 bytes).

### EX-H09 — Reset replaces keys (HTTP-22)

When `POST /api/test/reset` with `{"now":0,"keys":[{"apiKey":"k2","limit":1,"windowMs":1000,"burst":0}]}` is sent
Then an echo with `k1` returns 401 `INVALID_API_KEY`
And `GET /api/echo?x=a` with `X-Api-Key: k2` returns 200 `{"x":"a"}` with `X-RateLimit-Limit: 1` and
`X-RateLimit-Remaining: 0`.

### EX-H10 — Set-now keeps logs and validates input (HTTP-30, HTTP-31, HTTP-32)

Given `k1` with `limit = 1`, `burst = 0`, `windowMs = 1000` and one echo with `k1` already allowed at T = 0
When `POST /api/test/set-now` with `{"now":500}` is sent
Then an echo with `k1` returns 429 with `X-RateLimit-Reset: 500` and `Retry-After: 1`.
When `POST /api/test/set-now` is then sent with `{"now":-1}`, `{"now":"900"}`, `{"now":1.5}`, `{}`, `[]` or
an empty body
Then the response is 400 `{"error":{"code":"VALIDATION_ERROR"}}`
And a following echo with `k1` still returns 429 with `X-RateLimit-Reset: 500` (the clock stayed at 500).
When `POST /api/test/set-now` with `{"now":200}` (backwards) is sent
Then an echo with `k1` returns 429 with `X-RateLimit-Reset: 800`.

### EX-H11 — Unknown routes (HTTP-04)

When any of these is sent: `GET /api/unknown`, `POST /api/echo`, `GET /api/test/reset`, `GET /api/echo/?x=a`,
`GET /API/ECHO?x=a`, `GET /api/%ZZ`, `OPTIONS /api/echo`, all with `X-Api-Key: k1`
Then the response is 404 `{"error":{"code":"NOT_FOUND"}}`.
When `POST /api/echo` with `Content-Type: application/json` and the malformed body `{` is sent
Then the response is still 404 `NOT_FOUND`, not 400.
When `HEAD /api/echo?x=a` with `X-Api-Key: k1` is sent
Then the response is 404 without a body.
When `GET /api/ech%6F?x=a` with `X-Api-Key: k1` is sent
Then it is the echo route (the path is compared after percent-decoding) and returns 200 `{"x":"a"}`.
And an echo with `k1` sent after only the 404 requests reports remaining 2 (none of them was counted).

### EX-H12 — Before the first reset (HTTP-06)

Given the process has just started and no reset has been sent
When `GET /api/echo?x=a` is sent with `X-Api-Key: k1`
Then the response is 401 `{"error":{"code":"INVALID_API_KEY"}}`.

### EX-H13 — Test endpoints ignore gateway rules (HTTP-23)

When `POST /api/test/set-now` with `{"now":0}` is sent without `X-Api-Key`
Then the response is 200 `{"ok":true}` without `X-RateLimit-*` headers.

### EX-H14 — Oversized body (HTTP-05, HTTP-21)

When `POST /api/test/reset` is sent with a valid body padded with an unknown field to 1 MiB + 1 byte
Then the response is 413 `{"error":{"code":"PAYLOAD_TOO_LARGE"}}` and the previous state is kept.
When `POST /api/test/set-now` is sent with `{"now":500}` padded to 1 MiB + 1 byte
Then the response is 413 `PAYLOAD_TOO_LARGE` and the clock is unchanged.

## 5. Out of scope

- TLS, a real reverse proxy, CORS, and disabling the test endpoints in production.
- Requests that the Node.js HTTP server rejects before routing, such as a malformed request line or
  headers larger than 16 KiB. Node and Fastify answer those themselves.
- Process configuration (port, host): see `specs/03-design.md`.
