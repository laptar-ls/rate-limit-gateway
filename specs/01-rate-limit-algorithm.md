# Spec 01 — Rate-Limit Algorithm

| | |
|---|---|
| Status | Approved |
| Source | `docs/requirements.md`, section "Domain" |
| Related | `specs/02-http-contract.md` (how these rules are exposed over HTTP) |

## 1. Purpose

This spec defines how the gateway decides whether a request made with a given API key is
allowed, and which quota figures it reports for that decision. It is independent of HTTP:
spec 02 maps the results to status codes, headers and bodies.

## 2. Terms

| Term | Meaning |
|---|---|
| Key config | `{ apiKey, limit, windowMs, burst }` for one API key. |
| Capacity | `limit + burst`: the maximum number of accepted requests a key may have inside one window. |
| `T` | The current time in milliseconds, read from the gateway clock (ALG-01). |
| Log | The list of timestamps of **accepted** requests for one key. |
| In the window | A timestamp `t` is in the window at `T` when `t > T − windowMs`. This includes timestamps greater than `T` (ALG-15). |
| Decision | The result of evaluating one request: allowed or denied, plus the reported figures (ALG-11 to ALG-14). |

## 3. Decisions on the source text

The source gives three admission rules (`docs/requirements.md` lines 26–28):

1. Line 26: "allow if `count < limit`, **or** if `count < limit + burst` AND this request consumes burst
   when `count >= limit`". "Consumes burst" is not defined. Read as "takes one of the burst slots above
   `limit`", the rule says `count < limit` or `limit ≤ count < limit + burst`, which is the same as rule 3.
2. Line 27: "Allow if `count < limit`. Burst: additionally allow up to `burst` extra requests that are
   spaced such that..." The sentence is unfinished, so the spacing condition cannot be implemented.
3. Line 28: "**Canonical rule for tests:** Allow if `count < limit + burst`."

**D1 — Admission rule (ALG-06, ALG-11).** This spec adopts rule 3. The source marks it as the rule for
tests, it is complete, rule 1 reduces to it under its only sensible reading, and only rule 2 (unfinished)
would differ. It also matches the header prescribed on the same line, `X-RateLimit-Limit: limit+burst`.
Burst therefore means *extra capacity in the window* and has no separate consumption or refill logic.

Other gaps in the source and how this spec resolves them:

| ID | Question | Decision and reason | Requirement |
|---|---|---|---|
| D2 | Is a timestamp exactly `T − windowMs` still in the window? | No. The source says "drop timestamps ≤ T − windowMs". | ALG-04 |
| D3 | Are denied requests recorded? | No. The source says "timestamps of accepted requests"; recording denials would also keep a client that retries too early blocked forever. | ALG-07 |
| D4 | Is "remaining" computed before or after the current request? | After: it answers "how many more requests would be allowed right now". It is 0 when denied. | ALG-12 |
| D5 | Is "reset" computed before or after the current request is recorded? | After. An allowed first request then reports `windowMs`: the time until its own slot is free again. | ALG-13 |
| D6 | Can "retry after" be 0? | No. Reset is always ≥ 1 ms, so `ceil(reset / 1000)` is always ≥ 1. A client told to retry after 0 s would retry at once and be denied again. | ALG-14 |
| D7 | Several requests with the same `T`? | Each is evaluated and counted separately, in arrival order. Merging them would let N simultaneous requests share one slot. | ALG-08 |
| D8 | Can the clock move backwards? | Yes. The test endpoint accepts any valid `now`; rejecting a lower value would be an invented rule. The same formulas apply unchanged. | ALG-15 |
| D9 | Can times and config values be fractional? | No. The clock counts whole milliseconds, and whole numbers are what make reset ≥ 1 (D6). | ALG-02 |
| D10 | Does applying a config add to or replace the previous one? | Replace, and all logs are emptied. The endpoint is a reset used for test isolation, so no state may carry over. | ALG-03 |
| D11 | Which config values are valid? | `limit ≥ 0`, `burst ≥ 0`, `limit + burst ≥ 1`, `windowMs ≥ 1`. The canonical rule is well defined for `limit = 0` (capacity = burst), so it is allowed; a capacity of 0 or a window of 0 ms would make every figure meaningless. Upper bound 2^52 − 1 so every sum stays an exact integer in JavaScript (largest sum 2^53 − 2). | ALG-02 |
| D12 | Which API keys are valid? | Printable ASCII without commas and without surrounding spaces. Other strings cannot arrive unchanged in an HTTP header: surrounding whitespace is stripped, non-ASCII bytes are not reliably decoded, and a header sent twice arrives joined with `", "`. Such a key could be configured but never matched reliably. | ALG-02 |

## 4. Requirements

### Clock and configuration

- **ALG-01 — Clock source.** The limiter MUST use `T` from the gateway clock, never the system clock. At
  process start `T = 0`. After that `T` changes only when a test endpoint of spec 02 sets it (reset or
  set-now).
- **ALG-02 — Valid values.** Let `MAX = 2^52 − 1` (4 503 599 627 370 495). An *integer* is a JSON number
  whose parsed value is a whole number (`5`, `5.0` and `5e0` are all the integer 5; `5.5` is not).
  - `T`: integer, `0 ≤ T ≤ MAX`.
  - `apiKey`: string of 1 or more characters in the range U+0020–U+007E (printable ASCII), without a comma,
    that does not start or end with a space.
  - `limit`: integer, `0 ≤ limit ≤ MAX`.
  - `burst`: integer, `0 ≤ burst ≤ MAX`.
  - `limit + burst ≥ 1`.
  - `windowMs`: integer, `1 ≤ windowMs ≤ MAX`.

  Spec 02 defines how invalid values are rejected.
- **ALG-03 — Reconfiguration.** Applying a new set of key configs MUST replace the previous set completely
  (keys not in the new set stop existing) and MUST empty the log of every key.

### Evaluating a request

For a request with a configured API key at time `T`, the limiter performs ALG-04 to ALG-07 in this order.

- **ALG-04 — Pruning.** Remove from the key's log every timestamp `t` with `t ≤ T − windowMs`, wherever
  it is in the log. A timestamp exactly `T − windowMs` is removed. Removed timestamps are gone for good:
  moving the clock back later does not restore them.
- **ALG-05 — Count.** `count` is the number of timestamps left in the log after pruning.
- **ALG-06 — Admission.** The request is **allowed** if and only if `count < limit + burst`. Otherwise it is
  **denied**.
- **ALG-07 — Recording.** If allowed, add `T` to the key's log. If denied, leave the log unchanged:
  denied requests never take up capacity.
- **ALG-08 — Same timestamp.** Requests evaluated at the same `T` are each counted separately; they are
  evaluated one after another and never merged.
- **ALG-09 — Key isolation.** Evaluating a request for one key MUST NOT change or depend on the log of any
  other key.
- **ALG-10 — Unknown key.** For an API key that is not in the current set of key configs, the limiter
  returns the result *unknown key*: no decision, no figures, and no log is created or changed. Spec 02
  defines the HTTP response.

### Reported figures

Every decision reports the following figures. Let `n` be the number of timestamps in the log after ALG-07
(`n = count + 1` when allowed, `n = count` when denied).

- **ALG-11 — Limit.** `limit + burst`.
- **ALG-12 — Remaining.** `limit + burst − n`. This is `limit + burst − (count + 1)` when allowed and `0`
  when denied.
- **ALG-13 — Reset.** The number of milliseconds until the oldest timestamp in the log leaves the window:
  `oldest + windowMs − T`, where `oldest` is the **smallest** timestamp in the log after ALG-07 (with a
  clock moved backwards the log is not in time order).
  Because `limit + burst ≥ 1`, the log is never empty after ALG-07, so reset is always defined and
  `reset ≥ 1`. For an allowed request `reset ≤ windowMs`.
- **ALG-14 — Retry after (denied only).** `ceil(reset / 1000)`, in whole seconds. Since `reset ≥ 1`,
  retry after is always ≥ 1.

### Clock moving backwards

- **ALG-15 — Backwards time.** If `T` is smaller than timestamps already in a log, those timestamps are in
  the window, count towards `count` and are candidates for `oldest`. Reset can then exceed `windowMs`. No
  other special handling applies.

## 5. Examples

Each example starts from a freshly applied configuration (ALG-03) unless it says it continues another
example. "Request at T" means one evaluation for the given key with the clock at `T`.

### EX-01 — Burst extends capacity (ALG-06, ALG-08, ALG-11, ALG-12, ALG-13, ALG-14)

Given key `k` with `limit = 2`, `burst = 1`, `windowMs = 1000`
When four requests arrive at T = 0
Then the decisions are:

| # | T | Result | Limit | Remaining | Reset | Retry after |
|---|---|---|---|---|---|---|
| 1 | 0 | allowed | 3 | 2 | 1000 | — |
| 2 | 0 | allowed | 3 | 1 | 1000 | — |
| 3 | 0 | allowed | 3 | 0 | 1000 | — |
| 4 | 0 | denied | 3 | 0 | 1000 | 1 |

### EX-02 — The window boundary is exclusive (ALG-04)

Continues EX-01 (log of `k` = `[0, 0, 0]`).
When a request arrives at T = 999
Then it is denied with remaining 0, reset 1, retry after 1
When a request arrives at T = 1000
Then the three timestamps `0` are removed because `0 ≤ 1000 − 1000`, and the request is allowed with
remaining 2 and reset 1000.

### EX-03 — The window slides (ALG-04, ALG-05, ALG-13)

Given key `k` with `limit = 2`, `burst = 0`, `windowMs = 1000`

| # | T | Log before → after pruning | Result | Remaining | Reset | Retry after |
|---|---|---|---|---|---|---|
| 1 | 0 | `[]` | allowed | 1 | 1000 | — |
| 2 | 500 | `[0]` | allowed | 0 | 500 | — |
| 3 | 999 | `[0, 500]` | denied | 0 | 1 | 1 |
| 4 | 1000 | `[0, 500]` → `[500]` | allowed | 0 | 500 | — |
| 5 | 1001 | `[500, 1000]` | denied | 0 | 499 | 1 |

### EX-04 — Denied requests are not recorded (ALG-07)

Given key `k` with `limit = 1`, `burst = 0`, `windowMs = 1000`
When requests arrive at T = 0 (allowed), T = 500 (denied) and T = 1000
Then the request at T = 1000 is allowed, because the log contains only `0`, which is pruned.
(Had the denied request at 500 been recorded, the request at 1000 would be denied.)

### EX-05 — Retry after rounds up (ALG-14)

Given key `k` with `limit = 1`, `burst = 0`, `windowMs = 2500` and one allowed request at T = 0
Then a denied request at each of the following T reports:

| T | Reset | Retry after |
|---|---|---|
| 0 | 2500 | 3 |
| 1499 | 1001 | 2 |
| 1500 | 1000 | 1 |
| 2499 | 1 | 1 |

### EX-06 — Burst 0 means capacity equals limit (ALG-06, ALG-08, ALG-11)

Given key `k` with `limit = 2`, `burst = 0`, `windowMs = 1000`
When three requests arrive at T = 0
Then requests 1 and 2 are allowed, request 3 is denied, and every decision reports limit 2.

### EX-07 — Keys are isolated (ALG-09)

Given keys `a` and `b`, each with `limit = 1`, `burst = 0`, `windowMs = 1000`
When a request for `a` and then a request for `b` arrive at T = 0
Then both are allowed, and a second request for `a` at T = 0 is denied.

### EX-08 — Clock moved backwards (ALG-15)

Given key `k` with `limit = 1`, `burst = 0`, `windowMs = 1000` and one allowed request at T = 1000
When a request arrives at T = 500
Then the timestamp 1000 is in the window (`1000 > 500 − 1000`), the request is denied, reset is
`1000 + 1000 − 500 = 1500` and retry after is 2.

### EX-09 — Reconfiguration empties logs (ALG-03)

Given key `k` with `limit = 1`, `burst = 0`, `windowMs = 1000` and one allowed request at T = 0
When the same key config is applied again and a request arrives at T = 0
Then the request is allowed with remaining 0.

### EX-10 — Unknown key (ALG-10)

Given only key `a` is configured, with `limit = 1`, `burst = 0`, `windowMs = 1000`
When a request for key `zzz` arrives at T = 0
Then the limiter returns *unknown key*
And a following request for `a` at T = 0 is allowed with remaining 0 (the unknown key changed nothing).

### EX-11 — Pruning works on an unordered log (ALG-04, ALG-13, ALG-15)

Given key `k` with `limit = 2`, `burst = 0`, `windowMs = 1000`

| # | T | Log before → after pruning | Result | Remaining | Reset |
|---|---|---|---|---|---|
| 1 | 1000 | `[]` | allowed | 1 | 1000 |
| 2 | 200 | `[1000]` | allowed | 0 | 1000 (oldest is 200, not 1000) |
| 3 | 1250 | `[1000, 200]` → `[1000]` | allowed | 0 | 750 |

At row 3, `200` is removed although it is not the first entry of the log.

### EX-12 — Pruned timestamps do not come back (ALG-04, ALG-15)

Given key `k` with `limit = 2`, `burst = 0`, `windowMs = 1000`
When requests arrive at T = 0, 0 (both allowed) and T = 1000 (allowed, the two `0` are removed)
And a request arrives at T = 500
Then it is allowed with remaining 0 and reset 1000: the log is `[1000, 500]`, because the timestamps removed
at T = 1000 are not restored when the clock moves back.

### EX-13 — Burst-only capacity (ALG-02, ALG-06, ALG-11)

Given key `k` with `limit = 0`, `burst = 2`, `windowMs = 1000`
When three requests arrive at T = 0
Then requests 1 and 2 are allowed with remaining 1 and 0, request 3 is denied, and every decision reports
limit 2.

### EX-14 — Only the gateway clock counts (ALG-01)

Given key `k` with `limit = 1`, `burst = 0`, `windowMs = 1000`, the gateway clock at T = 5000 and any
system time
When two requests arrive
Then the first is allowed with reset 1000 and the second is denied with reset 1000, whatever the system
time is and however much real time passes between them.

## 6. Out of scope

- Persistence, sharing state between processes, distributed limits (in-memory only).
- Memory bounds: after ALG-07 a log never holds more than `limit + burst` timestamps, so its size is
  bounded by the config.
