# Reflection: AI with a vague task vs AI with specs

**Setup.** The same AI model built the gateway twice. In the baseline it got only the task text and
"Implement this". In the main run it worked spec-first: two specs with explicit decisions and
Given/When/Then examples, an independent review of those specs, then design, failing tests and code. I set
the plan and the key choices (canonical rule, stack, spec structure) up front; Claude Code did most of the
writing.

**The vague task was not as hard for AI as expected.** The algorithm section contains three conflicting
rules, but one is marked "Canonical rule for tests", and the baseline picked it without hesitation. Its
window boundary, remaining and reset logic matched the specs. The contradiction I worried about most was not
where the two runs differed.

**They differed in everything the task does not say.** Without specs the AI made about nine silent choices:
it falls back to the system clock before the first reset, answers a missing `x` with `{"x":null}`, accepts
negative and fractional times, defaults a missing `burst` to 0, returns 405 for a wrong method and adds a
`message` field to errors. Each choice is reasonable. None is written down anywhere except in the code, a
second run could choose differently, and a reviewer cannot tell intended behaviour from accidental
behaviour. The specs turned the same questions into 24 numbered decisions with reasons, and every test
cites the requirement it checks.

**Reviewing the specs was where AI helped most.** Four AI reviewers with different lenses plus a skeptical
verifier for each found problems that would otherwise have become bugs or arguments with a grader:
examples that silently depended on unstated state, an "invalid reset keeps the clock" example that could
never fail, integer precision beyond 2^53, and Fastify defaults that quietly broke the contract (a `HEAD`
request ran the handler and used up quota, a malformed path bypassed the error handler, and a bad body on
an unknown route returned 400 instead of 404). These were found by reading and probing, before any code
existed. During implementation not a single spec gap came up, and the code was close to mechanical.

**AI was still weak in predictable places.** The author of a spec, human or AI, does not see its own
ambiguities: "an integer without a fractional part" looked precise until a reviewer asked about `1.0`. The
AI's own task plan had a dependency error that only showed when tests ran. Tests written against
`inject()` described the test harness, not the wire, until a real-socket test was added. And a green suite
written by the same author was not proof: an outsider's black-box tests and deliberate mutations still
found two real bugs at the HTTP edge and eight blind spots in the tests, all fixed spec-first. Finally, the specs
grew to cover HTTP-parser details. That made them testable, but some of it is more than a 1–3 day toy
needs.

**Takeaway.** With AI, writing code stops being the bottleneck; deciding behaviour is. A vague prompt does
not produce wrong code so much as undocumented decisions. A spec is the place where those decisions are made
once, visibly, by someone who owns them. AI is good at deriving consequences from a spec and at attacking
it from several angles, so the most valuable step was not generation but an independent, adversarial review
of the spec before implementation.
