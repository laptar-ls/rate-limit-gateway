# rate-limit-gateway

Toy HTTP gateway that rate-limits requests per API key (sliding window log with burst capacity).

## Sources of truth

- `docs/requirements.md` — the original task. Read-only. It contains contradictory draft wording.
- `specs/` — the authored specifications. They override `docs/requirements.md` where the two differ.
  - `specs/01-rate-limit-algorithm.md` — domain rules (`ALG-*`)
  - `specs/02-http-contract.md` — HTTP API (`HTTP-*`)
  - `specs/03-design.md` — technical design
  - `specs/tasks.md` — implementation tasks

## Rules

- Never implement behaviour that is not described in `specs/`.
- If a spec is ambiguous or incomplete: stop and ask, don't guess.
- Never edit `specs/` unless explicitly asked.
- Every test name starts with the requirement ID it verifies, e.g. `ALG-04: ...`.
- Stack: Node.js + TypeScript, Fastify, Vitest. In-memory storage only.

## Commands

- `npm install`
- `npm test` — run all tests once
- `npm run typecheck`
- `npm run dev` — start with reload; `npm run build && npm start` — production build
