---
name: test-red-team
description: Launch an adversarial reviewer (Opus) to find bugs IN THE TEST SUITE — tautological assertions, stub lies, jsdom-shim divergence, vacuous system checks, coverage gaps. Use when the user says "red team the tests", "audit the tests", "are our tests any good", or after adding a large batch of tests.
---

# Test-suite red-team review

Launches an **Opus** general-purpose agent to hunt bugs *in the tests
themselves*, not the production code. goldseam's whole pitch is trust —
a heal pipeline whose own tests lie is worse than no tests. Complementary
to [red-team-review](../red-team-review/SKILL.md) (prod code) and
[mutation-red-team](../mutation-red-team/SKILL.md) (dynamic check); run
all three at major change points.

## When to invoke

- User says: "red team the tests", "audit the tests", "find weak tests",
  "are our tests rigorous"
- After adding a large batch of tests
- After a red-team-review finds a bug the suite missed — ask "why didn't
  our tests find this?"
- Before publishing any release

## How to invoke

Use the `Agent` tool with:

- `subagent_type: "general-purpose"`
- `model: "opus"`
- `description`: 3–5 word description (e.g. `"Red-team test suite"`)
- `prompt`: follow the template below

## Prompt template

Fill the bracketed sections with current project state. Do NOT send as-is.

```
You are an adversarial code reviewer performing a red-team bug hunt on
the TEST SUITE of goldseam (Cypress self-healing plugin + CLI). Your
target is the correctness and rigor of the tests — not the production
code. Rank findings CRITICAL / HIGH / MEDIUM / LOW.

## Setup

Project: /Users/adamsohn/Projects/goldseam
Read AGENTS.md §"Tests + build" for the four suites:
- packages/goldseam/test/*.test.ts (vitest; jsdom for browser-side)
- scripts/system-test.mjs, scripts/hardening-test.mjs,
  scripts/heal-e2e-test.mjs (Module-API system suites; check() helpers)
You may run them (npm run build:packages first; suites start their own
demo server on 4173).

## What's worth hunting — the "how tests lie" checklist

1. Tautological assertions: for each test, ask "if the production code
   were replaced with a no-op / return [] / always-pass, would this test
   fail?" If no, it is vacuous.
2. Stub-Cypress lies: support-invariants.test.ts reimplements
   Cypress.on/listeners/currentRetry and mocha hooks. Where does the
   stub's semantics diverge from real Cypress 15 (listener ordering,
   throw propagation between listeners, afterEach `this` binding,
   retries())? A test passing against the stub proves nothing where the
   stub diverges.
3. jsdom lies: the pseudo-element getComputedStyle shim, cloneNode
   fidelity, TreeWalker semantics — do redaction tests pass for
   jsdom-specific reasons?
4. Vacuous system checks: in the three .mjs suites, do any check()
   calls assert something that cannot fail (wrong variable, always-true
   condition, checking existence of a file the suite itself created)?
5. Stub-model circularity: heal-e2e proves the engine end-to-end, but
   the stub emits the known-correct edit. Which failure modes of a real
   model does the E2E therefore never exercise? Is anything asserting
   the rerun rungs can actually REJECT a bad edit?
6. Coverage gaps: production branches no test exercises (engine error
   paths, CLI arg handling, runner failures, artifact-write failures,
   maxDomBytes truncation, ariaSnapshot: false).
7. Shared-state leakage: module-level `installed` guard + listener
   arrays in unit tests; port 4173 collisions between suites; .goldseam
   dir cleanup between scenarios.
8. Assertion granularity: length-only or existence-only assertions where
   content matters (artifact fields, ladder verdicts, redaction output).

## Output

300–600 words. Severity-grouped. For each finding:
- file:line reference
- one-line description of why the test is weak
- concrete trigger: "an implementation that does X would still pass"

No fixes — diagnose only. "No CRITICAL issues found" is valuable signal;
say so explicitly.
```

## Scripts and assets

No scripts today. Coverage helpers, if ever needed, live in this folder.

## Cleanup discipline

Same rules as [red-team-review](../red-team-review/SKILL.md): the agent
is read-only; no repo files; response inline; final `git status` check.
Confirmed gaps become tests (preferred) or AGENTS.md "Known deferred
findings" entries (accepted tradeoffs) — never silent knowledge.
