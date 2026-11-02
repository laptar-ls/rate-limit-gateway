# Requirements — Rate-Limited Public API Gateway (toy)

## Goal

Tiny gateway that rate-limits by API key using a **sliding window** plus burst token semantics as specified.

## Time box

1–3 days.

## Required artifacts (trainee)

1. At least **two written specs** you author yourself (store under `specs/` in your solution).  
2. Running implementation satisfying the HTTP contract.  
3. Short reflection (≤1 page) on AI vs specs.

**You will not receive pre-written specs.** Specs are a graded deliverable.

## Domain

- Key config: `{ apiKey, limit: N, windowMs, burst }`  
- Algorithm (required):  
  - Maintain timestamps of accepted requests per key (or equivalent).  
  - On request at time T: drop timestamps ≤ T \- windowMs.  
  - Let `count` \= remaining timestamps.  
  - Allow if `count < limit + burst`? **Required:** allow if `count < limit`, **or** if `count < limit + burst` AND this request consumes burst when `count >= limit`. Simpler mandatory rule:  
  - **Allow if count \< limit.** Burst: additionally allow up to `burst` extra requests that are spaced such that...  
  - **Canonical rule for tests:** Allow if `count < limit + burst`. Response headers: `X-RateLimit-Limit: limit+burst`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (ms until oldest timestamp exits window). On deny: `429` body `{ error: { code: "RATE_LIMITED" } }` \+ `Retry-After` seconds (ceil to reset).

Upstream toy route: `GET /api/echo?x=` returns `{ x }` when allowed (still counts against limit).

## HTTP

- `POST /api/test/reset` `{ now, keys:[{apiKey, limit, windowMs, burst}] }`  
- `POST /api/test/set-now` `{ now }` (limiter uses this clock)  
- `GET /api/echo?x=` header `X-Api-Key` required

## Non-goals

Real reverse proxy, TLS, distributed Redis (in-memory OK).