---
name: mutation-red-team
description: Launch an adversarial mutation-testing agent (Opus) that injects targeted regressions into goldseam's production code, runs the suites, and reports which mutations SURVIVED — surviving mutations are direct evidence of test-coverage gaps. Use when the user says "trickster", "mutation test", "break the code", "grade the tests", or after adding production code whose coverage is unproven.
---

# Mutation red-team (the trickster)

Launches an **Opus** general-purpose agent that does what a mischievous
reviewer would do if told "try to break this without the tests catching
it": pick a load-bearing invariant, silently mutate it, run
`npm run build:packages && npm run test:unit && npm run test:system &&
npm run test:hardening && npm run test:heal`, and report the verdict.

**Surviving mutations are the finding.** A SURVIVED mutation means the
suite cannot distinguish broken code from working code — a concrete gap
pointing at an invariant no test enforces. Complementary to
[test-red-team](../test-red-team/SKILL.md) (reads tests statically) and
[red-team-review](../red-team-review/SKILL.md) (reads prod statically);
this is the dynamic, empirical check.

This skill is also the seed of goldseam's own Phase-2 `mutation-guard`
ladder rung (re-break a healed target; the healed test must FAIL) — see
[docs/plugins/verification-ladder.md](../../../docs/plugins/verification-ladder.md).
Lessons learned here feed that stage's design.

## When to invoke

- User says: "trickster", "mutation test", "break the code", "grade the
  tests", "can my tests catch regressions"
- After a red-team-review finds a prod bug — confirm the regression test
  you added actually catches recurrence
- After a milestone that added production code
- Proactively on anything listed under AGENTS.md "Hard rules" /
  "Load-bearing invariants"

## How to invoke

Use the `Agent` tool with:

- `subagent_type: "general-purpose"`
- `model: "opus"`
- `isolation: "worktree"` — **mandatory as the outer guard**; the agent
  edits production code.
- **Copies beat worktrees for the mutation work itself** (hnswered
  incident, 2026-07-01: parallel agents resumed after transient errors
  were re-pointed at a shared worktree and corrupted each other's
  verdicts). The prompt template instructs the agent to snapshot the repo
  into its own fresh temp dir and work there. A worktree alone is fine
  for a single, non-resumed agent.
- `description`: 3–5 words (e.g. `"Mutation red-team validator"`)
- `prompt`: template below. ONE mutation per agent; for N mutations,
  issue N parallel Agent calls in a single message.
- Suites bind port 4173 — mutation agents run them sequentially per
  agent, and each suite manages its own server, but parallel agents on
  one machine WILL collide on the port. Either run agents sequentially,
  or have each agent export a distinct port via the demo script and
  baseUrl (currently hardcoded — treat port collisions as verdict
  contamination and re-verify).

## Curated mutations (this project)

Do NOT let the agent pick random lines — signal-to-noise on random
mutants is terrible. Hand-pick from AGENTS.md invariants. Starter set,
each tied to a named invariant:

1. **Never-mask** — in
   [packages/goldseam/src/support/index.ts](../../../packages/goldseam/src/support/index.ts),
   remove the `throw err` in the `finally` (or make `shouldRethrow`
   return `false`). Must be CAUGHT by the capture-rule unit tests; the
   system suite's broken-selector run must also fail (test goes green).
2. **Transparency** — make `shouldRethrow` return `true`
   unconditionally. Must be CAUGHT by the hardening user-swallow check.
3. **Retry-awareness** — drop the `attempt < Math.max(allowed, 0)` gate
   in `afterEach`. Must be CAUGHT by hardening retry-flaky (stale
   artifact appears).
4. **Redaction** — make `maskText` the identity function in
   [support/redact.ts](../../../packages/goldseam/src/support/redact.ts).
   Must be CAUGHT by redact unit tests AND the support-invariants
   healthy-capture test ([redacted-email] assertion).
5. **Assertion guard** — remove the `ASSERTION_CORE` check in
   [heal/validate.ts](../../../packages/goldseam/src/heal/validate.ts).
   Must be CAUGHT by heal-validate unit tests.
6. **Ambiguity guard** — accept `occurrences > 1` in `validateEdit`.
   Must be CAUGHT by the ambiguous-oldString unit test.
7. **Revert-on-failure** — in
   [heal/engine.ts](../../../packages/goldseam/src/heal/engine.ts), skip
   `ctx.revert()` on the failed path. Must be CAUGHT by the
   attempt-cap unit test (asserts spec reverted).
8. **Confidence floor** — drop the `minConfidence` give-up in
   [heal/stages.ts](../../../packages/goldseam/src/heal/stages.ts). Must
   be CAUGHT by the low-confidence unit test.
9. **Schema version** — stop writing `schemaVersion` in
   [plugin/artifacts.ts](../../../packages/goldseam/src/plugin/artifacts.ts).
   Must be CAUGHT by writer unit test + system schema check.
10. **Ladder teeth** — make `rerun` in
    [heal/stages.ts](../../../packages/goldseam/src/heal/stages.ts)
    return `pass` without running Cypress. Must be CAUGHT by the
    wrong-edit scenario in
    [scripts/heal-e2e-test.mjs](../../../scripts/heal-e2e-test.mjs)
    (a plausible-but-wrong stub edit must end `failed`, not `healed`).

## Prompt template

Fill the bracketed sections. Send ONE mutation per agent invocation.

```
You are a trickster. Your job is to introduce a specific regression into
production code, run the test suites, and report whether the tests
caught you. You are operating in an isolated git worktree — but do NOT
work there directly.

## Rules

- FIRST: snapshot the repo into your own fresh temp directory
  (`rsync -a --exclude node_modules --exclude .git <repo>/ <tmpdir>/`)
  and do ALL work in that copy. Then `npm install` inside the copy.
- Apply EXACTLY the mutation specified below. Do not invent others.
- Do not touch any test file, script under scripts/, or spec under
  cypress/. Mutate only the file named below.
- Ensure no other process holds port 4173 before running suites
  (`lsof -ti:4173`); if it is held by someone else's run, wait or
  report contamination rather than guessing.
- After applying the mutation, run in the copy:
    npm run build:packages && npm run test:unit && npm run test:system \
      && npm run test:hardening && npm run test:heal
  Capture stdout+stderr. Note which step failed first (if any).
- Revert the mutation before exiting so the worktree auto-cleans.

## Mutation

File: [ABSOLUTE PATH IN THE COPY]
Change: [EXACT BEFORE → AFTER]
Reasoning-for-humans: [one sentence — which AGENTS.md invariant this probes]

## Verdict

Report exactly:
- CAUGHT if any step failed after the mutation
- SURVIVED if all passed

For CAUGHT: name the failing test(s); one to three sentences — is the
failure specific to the invariant, or incidental (build error)?
For SURVIVED: state what the code now does incorrectly and what kind of
test would have caught it. No fix — diagnosis only.

## Output format

~150–300 words. Lead with the one-word verdict. Before exiting,
`git status` in the worktree must be clean. Verify and report.
```

## Reading the results

- **Mutation score** = CAUGHT / total. Under 80% is a weak suite; under
  50% is dangerous.
- **Surviving mutations by invariant** = the prioritized list of missing
  tests. Every SURVIVED maps to one regression test to add (or one
  AGENTS.md deferred-finding entry if legitimately unobservable).
- **Compare to prior runs** — a mutation CAUGHT last cycle that now
  SURVIVES means a recent change weakened coverage.
- A build-error CAUGHT (type error, not a test) is weak evidence — note
  it; the invariant may still lack a behavioral test.

## Cleanup discipline

**Stricter than the other red-team skills** because this agent writes
code.

- Clean revert → worktree auto-deletes. If changes are left, inspect
  once, then `git worktree remove <path>`.
- Mutation output belongs inline in the conversation, not in a repo
  file. Condense SURVIVED findings before reporting.
- Before returning control: `git status` clean on the main tree,
  `git worktree list` shows no strays, and nothing is listening on 4173.
