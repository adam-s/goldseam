# The verification ladder — folding real-world QA patterns into goldseam

Catalog date: 2026-07-03. These patterns are drawn from prior
agent-orchestration and QA-tooling work; each is described here as a
transferable technique, not a citation.

## The architectural rule that makes "later" cheap

Every stage of the heal pipeline communicates **only through versioned
artifact files** — artifact files are the sole inter-stage contract. A stage
is anything that reads artifacts and writes artifacts. Adding a verification
or adversarial stage later is therefore *inserting a stage implementation*,
never *refactoring the pipeline*.

The one design commitment to make early so this stays true:

```ts
// The heal pipeline is an ordered list of stages, configured, not hardcoded.
interface HealStage {
  name: string
  run(ctx: HealContext): Promise<StageVerdict>   // verdict is an artifact
}
// Phase 1 (shipped, cy.prompt parity):
stages: ['triage', 'propose', 'resolve', 'oracle', 'rerun-test', 'rerun-spec']
// Later phases — same pipeline, more rungs:
stages: ['triage', 'propose', 'resolve', 'oracle', 'rerun-test', 'rerun-spec',
         'adversary', 'mutation-guard', 'review', 'deliver-pr']
```

A `StageVerdict` artifact records: stage name, verdict
(pass/fail/refuted/gave-up), evidence, and cost. Any failing rung stops the
ladder and the heal is reported, not delivered. PR bodies render the ladder.

## The rungs, and the pattern each one applies

### Phase 1 — cy.prompt parity (shipped)

| Rung | Mechanism | Pattern |
|---|---|---|
| `triage` | Pre-model: a "missing" selector still present in the capture is timing/state, not drift — give up, zero model calls | offline pre-check |
| `propose` | RepairRunner: capture in, strict-JSON minimal edit out | blueprint |
| `resolve` | The healed selector must resolve in the captured DOM (zero matches / ambiguity reject with feedback) | offline static check |
| `oracle` | **Shipped 2026-07.** Healed selector must land on the known-good aria identity (role + accessible name, `.goldseam/oracle.json`) resolved via `getAllByAria` against the capture — offline, before any rerun. Skips with evidence when no identity is on file | review pattern: diff the proposed fix against a known-good fix |
| `rerun-test` / `rerun-spec` | Module API + grep: the healed test, then the whole spec, must pass | shipped |
| Outer loop | Retry propose with feedback, **hard attempt cap**, all-green stop condition | iterate pattern: recursive propose→verify with deterministic PASS/FAIL and a max depth. Phase 1 is this loop with N=1 candidate |

### Phase 2 — trust hardening (the anti-false-green rungs)

| Rung | Mechanism | Pattern |
|---|---|---|
| `mutation-guard` | After a heal passes, **re-break the healed target** (re-apply the mutation class in a worktree) and assert the healed test FAILS. A heal that can't fail is a tautology — reject it | mutation-testing: worktree-isolated mutation, SURVIVED/CAUGHT verdict, hand-picked invariants over random mutants. Enforces "never weaken assertions" *empirically* |
| `snapshot-diff` | Diff the healed run's full suite results against the last-green baseline; only flipped signals surface | harness-diff: per-run diff, verdict line "no signal flipped / expected change / unexpected regression" |
| Candidate fan-out | N parallel proposals in isolated worktrees, first to pass the ladder wins (or best-of by confidence) | parallel iterate instances + worktree isolation |

### Phase 3 — adversarial gate (LLM rungs, still behind the same interface)

| Rung | Mechanism | Pattern |
|---|---|---|
| `adversary` | A second, independent model call whose only goal is to **refute the heal**: "the most dangerous heal produces a correct-looking green. Prove this one is false." Refuted ⇒ no PR | refute-first adversary: "assume a violation exists until you've tried hard and failed"; "prior checks test what the builders thought to test — you test what they didn't" |
| `review` | Rubric-scored review of the heal diff: selector-priority compliance, assertion integrity, minimality; scores below floor block | rubric review: "a score without a cited path/value is just an opinion"; a small fixed-point rubric; behavioral-coverage criticality scoring |
| `regression-pin` | Every delivered heal ships with a pinned regression artifact: the exact failure it fixed, replayable | regression-pinning: "pin a regression test for every fix that escaped to runtime" |

## The inversion the oracle enables

Today the model authors a selector string and four rungs verify it. With the
aria tree as an addressing space (`getAllByAria` resolves an identity to
elements; `deriveSelector` turns an element back into the best native
selector), the model's untrusted output can shrink from "a selector" to
"which tree node" — code derives and verifies the string. The deterministic
tier that skips the model entirely for pure renames (identity → element →
derived selector → ladder) is designed on this base; identity provenance (a
green-run manifest instead of a hand-written oracle file) is the missing half.

## Benchmark loop — the eval harness pattern

The benchmark is itself a run-eval/compare loop: each mutation branch run
produces a scored result artifact; runs auto-compare against the previous
benchmark (REGRESSION / IMPROVEMENT / NEUTRAL). Mutation branches with
recorded oracle selectors are the `fix.diff` ground truth. Publishing
heal-rate by selector style and by ladder rung ("caught by adversary: N") is
data nobody else has.

## The disciplines to carry forward

- **Mutation testing** — isolated worktree per candidate, a deterministic
  verdict vocabulary (SURVIVED/CAUGHT), invariant-driven mutation selection
  over random mutants.
- **Harness discipline** — one mutation per cycle, a clean tree enforced,
  equivalent-mutant accounting, and a "how validation lies" checklist
  (tautological assertions, silent skips, boundary bypasses) that seeds the
  `review` rung's rubric.
- **Adversary / review prompts** — read-only, refute-first, evidence-cited.
- **Iterate + compare control flow** — hard caps, deterministic stop
  conditions, fail-loud argument guards.

## Why this never needs a refactor

1. Rungs are configuration (`stages: [...]`), so parity ships with the
   Phase-1 rungs and the ladder grows by config + new `HealStage`
   implementations.
2. Verdicts are artifacts, so every new rung automatically appears in
   reports, PR bodies, and the benchmark without touching those consumers.
3. LLM rungs use the same RepairRunner-style pluggable model interface — the
   adversary can be a *different* model than the proposer (cheap local
   skeptic vs API proposer, or vice versa) with zero core changes.
4. Worktree isolation is a stage-internal concern (the rung that needs a
   worktree makes one), not a pipeline concern.
