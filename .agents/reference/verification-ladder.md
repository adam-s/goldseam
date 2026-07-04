# The verification ladder — folding real-world QA patterns into goldseam

Catalog date: 2026-07-03. Source: survey of `.claude/skills` and
`.claude/agents` across ~/Projects (agent-spec, job-hunter, waypoint,
detectauto, claudodidact/alphadidactic, intercept family, Archon,
rubiks-cube-mcp-2, goblins).

## The architectural rule that makes "later" cheap

Every stage of the heal pipeline communicates **only through versioned
artifact files** (the allure paradigm: artifact files are the only
inter-stage contract).
A stage is anything that reads artifacts and writes artifacts. Therefore
adding a verification or adversarial stage later is *inserting a stage
implementation*, never *refactoring the pipeline*.

The one design commitment to make in Phase 1 so this stays true:

```ts
// The heal pipeline is an ordered list of stages, configured, not hardcoded.
interface HealStage {
  name: string
  run(ctx: HealContext): Promise<StageVerdict>   // verdict is an artifact
}
// Phase 1 config (cy.prompt parity):
stages: ['propose', 'rerun-test', 'rerun-spec', 'oracle', 'deliver-pr']
// Phase 3 config (full ladder) — same pipeline, more rungs:
stages: ['propose', 'rerun-test', 'rerun-spec', 'oracle',
         'adversary', 'mutation-guard', 'review', 'deliver-pr']
```

A `StageVerdict` artifact records: stage name, verdict
(pass/fail/refuted/gave-up), evidence, and cost. Any failing rung stops the
ladder and the heal is reported, not delivered. PR bodies render the ladder.

## The rungs, and which existing skill each one is

### Phase 1 — cy.prompt parity (deterministic rungs only)

| Rung | Mechanism | Pattern source |
|---|---|---|
| `propose` | RepairRunner: capture in, strict-JSON minimal edit out | blueprint |
| `rerun-test` | Module API + grep: the healed test alone must pass | curriculum M5 |
| `rerun-spec` | Full spec rerun: blast-radius check | curriculum M5 |
| `oracle` | **Shipped 2026-07.** Healed selector must land on the known-good aria identity (role + accessible name, `.goldseam/oracle.json`) resolved via `getAllByAria` against the capture — offline, before any rerun. Skips with evidence when no identity is on file | agent-spec `reviewer` — "diff proposed fix against known-good fix" |
| Outer loop | Retry propose with feedback, **hard attempt cap**, all-green stop condition | **agent-spec `iterate`** — recursive propose→verify with deterministic PASS/FAIL and max depth. Phase 1 is this loop with N=1 candidate |

### Phase 2 — trust hardening (the anti-false-green rungs)

| Rung | Mechanism | Pattern source |
|---|---|---|
| `mutation-guard` | After a heal passes, **re-break the healed target** (re-apply the mutation class in a worktree) and assert the healed test FAILS. A heal that can't fail is a tautology — reject it | **job-hunter `mutation-red-team`**: worktree-isolated mutation, SURVIVED/CAUGHT verdict, hand-picked invariants over random mutants. This rung enforces the "never weaken assertions" invariant *empirically* |
| `snapshot-diff` | Diff the healed run's full suite results against the last-green baseline; only flipped signals surface | **waypoint `harness-run`**: per-cell diff vs prior run, verdict line "no signal flipped / expected change / unexpected regression" |
| Candidate fan-out | N parallel proposals in isolated worktrees, first to pass the ladder wins (or best-of by confidence) | **agent-spec `iterate`** parallel instances + **job-hunter** worktree isolation |

### Phase 3 — adversarial gate (LLM rungs, still behind the same interface)

| Rung | Mechanism | Pattern source |
|---|---|---|
| `adversary` | A second, independent model call whose only goal is to **refute the heal**: "the most dangerous heal produces a correct-looking green. Prove this one is false." Refuted ⇒ no PR | **detectauto `provenance-adversary`** ("assume a violation exists until you've tried hard and failed") + **claudodidact `adversary-agent`** ("prior checks test what the builders thought to test; you test what they didn't") |
| `review` | Rubric-scored review of the heal diff: selector-priority compliance, assertion integrity, minimality; scores below floor block | **detectauto `quote-reviewer`** ("a score without a cited path/value is just an opinion") + **intercept `reviewer-agent`** (0–2 rubric) + **Archon `pr-test-analyzer`** (behavioral coverage, 1–10 criticality) |
| `regression-pin` | Every delivered heal ships with a pinned regression artifact: the exact failure it fixed, replayable | **rubiks-cube-mcp-2 `user-journey`** ("pin a regression test for every fix that escaped to runtime") |

## The inversion the oracle enables

Today the model authors a selector string and four rungs verify it. With
the aria tree as an addressing space (`getAllByAria` resolves an identity
to elements; `deriveSelector` turns an element back into the best native
selector), the model's untrusted output can shrink from "a selector" to
"which tree node" — code derives and verifies the string. The deterministic
tier that skips the model entirely for pure renames (identity → element →
derived selector → ladder) is designed on this base; identity provenance
(a green-run manifest instead of a hand-written oracle file) is the
missing half.

## Benchmark loop (M6) — the eval harness pattern

The benchmark is itself an instance of **agent-spec's run-eval/compare**:
each mutation branch run produces a scored result artifact; runs
auto-compare against the previous benchmark (REGRESSION / IMPROVEMENT /
NEUTRAL per **agent-spec `compare`**). Mutation branches with recorded
oracle selectors are the `fix.diff` ground truth per **agent-spec
`reviewer`**. Publishing heal-rate by selector style and by ladder rung
("caught by adversary: N") is data nobody else has.

## Which skill lineage to port from

- **job-hunter's `mutation-red-team`** (2026-05-06, 26 KB) — take the
  *architecture*: isolated worktree per candidate, deterministic verdict
  vocabulary (SURVIVED/CAUGHT), invariant-driven mutation selection.
- **waypoint's triad** (2026-05-17) — take the *discipline*: one mutation
  per cycle, clean tree enforced, equivalent-mutant accounting, the
  12-point "how validation lies" checklist (tautological assertions, silent
  skips, boundary bypasses) — that checklist becomes the `review` rung's
  rubric seed.
- **detectauto's agent pair** — take the *prompt shapes* for the
  `adversary` and `review` rungs nearly verbatim; they're already
  read-only, refute-first, and evidence-cited.
- **agent-spec's `iterate` + `compare`** — take the *control flow*: hard
  caps, deterministic stop conditions, fail-loud argument guards.

## Why this never needs a refactor

1. Rungs are configuration (`stages: [...]`), so parity ships with four
   rungs and the ladder grows by config + new `HealStage` implementations.
2. Verdicts are artifacts, so every new rung automatically appears in
   reports, PR bodies, and the benchmark without touching those consumers.
3. LLM rungs use the same RepairRunner-style pluggable model interface —
   the adversary can be a *different* model than the proposer (cheap local
   skeptic vs API proposer, or vice versa) with zero core changes.
4. Worktree isolation is a stage-internal concern (the rung that needs a
   worktree makes one), not a pipeline concern.
