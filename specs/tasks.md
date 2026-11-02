# Implementation Tasks

Derived from `specs/03-design.md`. Each task lists the requirements it implements and the tests that must
pass when it is done. Tests are written first (task 0) and must fail before task 1 starts.

| # | Task | Files | Requirements | Done when |
|---|---|---|---|---|
| 0 | Write failing tests for every example in specs 01 and 02, plus interface stubs from the design | `tests/**`, `src/*.ts` (stubs that throw) | all | `npm test` runs and every test fails for "not implemented" |
| 1 | Gateway clock | `src/clock.ts` | ALG-01, HTTP-06 (clock part) | `tests/unit/clock.test.ts` passes |
| 2 | Sliding-window limiter | `src/limiter.ts` | ALG-03 – ALG-15 | `tests/unit/limiter.test.ts` passes |
| 3 | Body validation for the test endpoints | `src/validation.ts` | ALG-02, HTTP-05 (object check), HTTP-20, HTTP-30 | `tests/unit/validation.test.ts` passes |
| 4 | App skeleton: error body, not-found and error handlers, Fastify settings | `src/errors.ts`, `src/app.ts` | HTTP-01 – HTTP-05 | `tests/http/errors.test.ts` passes |
| 5 | Test endpoints | `src/app.ts` | HTTP-06, HTTP-20 – HTTP-23, HTTP-30 – HTTP-32 | `tests/http/test-endpoints.test.ts` passes |
| 6 | Echo endpoint: auth, rate limiting, headers, upstream | `src/app.ts` | HTTP-10 – HTTP-15 | `tests/http/echo.test.ts` passes |
| 7 | Server entry point and real-socket smoke test | `src/server.ts` | design §3 `server.ts` | `tests/e2e/server.test.ts` passes, `npm run build && npm start` serves requests |
| 8 | Coverage check: every requirement ID has at least one test | — | all | traceability table in `README.md` has no gaps |

Rules for every task (from `CLAUDE.md`): do not change specs or tests to make code pass; if a spec gap shows
up, fix the spec first, then the code.
