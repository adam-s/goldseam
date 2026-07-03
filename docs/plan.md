# goldseam build plan

The road from this repo (docs + aria-snapshot) to a launched, best-in-class
open-source plugin. Plan date: 2026-07-03. The design inputs live in
[docs/plugins/](plugins/README.md); this file is the execution order.

**North star:** Phase-1 parity with cy.prompt's healing loop, for the suites
people already have — capture → propose → verify → PR, self-hosted, every
heal a reviewed commit. Then the trust rungs nobody else ships.

## Ground rules

1. **Open-source ready from the first commit.** The repo is a public
   artifact: every file is part of the product's story. Conventions come
   from the 0.3–1.3M-download predecessors catalogued in
   [patterns.md](plugins/patterns.md) and [packaging.md](plugins/packaging.md)
   — two-line install, zero-config defaults, typed options, artifact files
   as the contract, wide peer ranges. We copy their citizenship and beat
   them on capability.
2. **Invariants are non-negotiable** (tested, not aspirational): no `cy.*`
   in the fail handler and capture can never mask a failure; heals are
   selector-only, exact-string, minimal edits that never weaken assertions;
   the model sees runtime snapshots, never app source; no runtime
   substitution — every heal is a reviewed commit; give-up is a
   first-class, reported outcome.
3. **Stages are config, verdicts are artifacts** (the
   [verification-ladder](plugins/verification-ladder.md) rule). Parity
   ships with four rungs; later rungs are inserted stage implementations,
   never refactors.
4. **The test surface is the usage catalog.** Demo-shop widgets and
   benchmark axes map 1:1 to [cy-prompt-usage.md](plugins/cy-prompt-usage.md)
   — we test against what people actually do with the incumbent.

## Milestones

### M0 — Name-lock & repo foundation

- **Adam's call:** goldseam vs regraft. Check GitHub org + npm scope,
  publish 0.0.1 placeholder, grab domain. Blocks *publishing*, not coding —
  M1+ proceed under the working name (`git grep -l goldseam` + one rename).
- Monorepo root: npm workspaces, root tsconfig, .gitignore, MIT license
  (aria-snapshot stays Apache-2.0 with NOTICE).
- CI skeleton: build + typecheck + unit tests on push.

**Done when:** name is final; `npm install && npm run build` is green in CI.

### M1 — The capture plugin (`packages/goldseam`)

- Subpath entries per [packaging.md](plugins/packaging.md): `./support`
  (`installGoldseam(options?)`), `./plugin` (`goldseam(on, config,
  options?)`), `./types` (artifact schema), `bin` CLI shell.
- Port the proven capture pipeline: `Cypress.on('fail')` stash (no `cy.*`;
  `finally { throw err }`) → `afterEach` + namespaced `cy.task` → Node
  writer → `.goldseam/failures/<slug>-<hash6>.json`, `schemaVersion: 1`,
  aria snapshot via `@goldseam/aria-snapshot`.
- Options: `failuresDir`, `ariaSnapshot`, `maxDomBytes` (+ truncation
  flag), `redact` (strip value-bearing attributes, mask email/number-like
  text — the model consumes this DOM, so redaction is a capture concern,
  not a later polish).
- Unit tests (vitest): slug/hash/writer/schema validation, redaction.
- **The capture-rule test:** a *failing capture* still yields the original
  test error, and a fail handler that re-throws never turns a red test
  green. This is the professionalism proof.

**Done when:** system test shows a broken selector produces a schema-valid
artifact, a green run writes nothing, and the capture-rule test passes.

### M2 — Fixture app with full scenario coverage

- Demo shop grown to cover the usage-catalog clusters
  ([cy-prompt-usage.md](plugins/cy-prompt-usage.md) mapping table):
  hover tooltip (incl. one portal-rendered), modal open/close (both
  `not.exist` temporal flavors), filterable product list (count/order/
  first-last), checkbox group + quantity stepper (multi/repeat actions),
  labeled login/checkout form with enabled/disabled states, scroll
  container, one XHR-backed action.
- Dogfood suite: the repo wires its own plugin exactly as a target project
  would; at least one spec per scenario cluster.

**Done when:** suite is green locally and in CI, and every row of the
usage-matrix table has a covering spec.

### M3 — The heal engine (`goldseam heal`, propose rung)

- `HealStage` pipeline with `stages: [...]` config and `StageVerdict`
  artifacts (`.goldseam/heals/`), per the verification ladder.
- `RepairRunner` interface; first runner: `claude` via
  `claude -p --output-format json` (zero-setup, no SDK dependency).
  **Dev/benchmark model for now: Sonnet 5** (`claude-sonnet-5` — via
  `claude -p --model sonnet` or the API runner); fast and cheap enough to
  iterate the prompt contract against, and the benchmark's model axis can
  revisit the default later.
- Prompt contract + reply schema (`{ edits: [{file, oldString, newString}],
  confidence, reasoning, giveUp? }`) documented beside the artifact schema
  — the schema doc *is* the prompt-engineering doc.
- Edit validation enforces the invariants mechanically: selector-only,
  exact-string, single-site minimal diff; anything else is rejected before
  apply. `--dry-run` supported from day one.
- Give-up paths wired: `about:blank`, `captureError`, low confidence,
  model refusal — all produce a reported no-heal verdict.

**Done when:** a broken demo-shop selector yields a validated minimal edit
applied to a working copy (and `--dry-run` prints it without applying).

### M4 — Verification rungs + outer loop (parity complete)

- `rerun-test`: Module API + `@cypress/grep`, the healed test alone must
  pass. `rerun-spec`: full spec, blast-radius check. Revert on any failure.
- Outer loop: retry propose with failure feedback, **hard attempt cap**,
  deterministic stop conditions; every rung's verdict recorded either way.
- Heal artifacts carry `tier: cache | model` from day one (cy.prompt's
  two-tier healing is the capability bar; the cache tier itself is
  post-v0.1, but the schema shouldn't need a bump to add it).

**Done when:** one end-to-end heal on a demo-shop mutation passes both
rungs with the ladder recorded in artifacts, and a deliberately unhealable
break produces a clean, reported give-up.

### M5 — Delivery + the runner matrix

- `goldseam pr`: branch, commit, PR with the ladder, reasoning, tier, and
  the exact failure it fixes rendered in the body.
- `goldseam report`: md/json summary of captures + heals + give-ups.
- Runner matrix behind the same interface: `openai:`/`anthropic:` via
  Vercel AI SDK `generateObject` + schema; `ollama:` local HTTP (the
  air-gapped story — [#33927](https://github.com/cypress-io/cypress/issues/33927)
  and [#32673](https://github.com/cypress-io/cypress/issues/32673) are the
  demand evidence); `cmd:` stdio escape hatch.

**Done when:** the 90-second demo works (break selector → red run →
`goldseam heal` → PR appears), and `ollama:` heals at least one mutation
with no network egress.

### M6 — Oracle rung + the benchmark (the launch asset)

- `oracle` rung: healed selector must resolve to the element the mutation
  intended — `matchesAriaTree` from `@goldseam/aria-snapshot` against the
  pre-mutation capture; mutation branches record oracle selectors as
  ground truth.
- Benchmark harness: N mutation branches × the selector-style axis from
  usage-catalog cluster F (`data-cy` / `id` / role+text / `:contains()`
  chains / brittle auto-generated descendant CSS); results are artifacts;
  runs auto-compare against the previous benchmark
  (REGRESSION / IMPROVEMENT / NEUTRAL).
- Explore the cheap differentiator: same-origin iframe capture (cy.prompt
  can't; our DOM walk might) — one benchmark cell decides if it's real.

**Done when:** a published heal-rate-by-selector-style table exists with
tier breakdown — data nobody else has.

### M7 — Launch

- Docs bar per [packaging.md](plugins/packaging.md): 60-second quickstart,
  the healed-PR GIF, options reference, compatibility statement,
  troubleshooting (captures not appearing → restart after config edit;
  the `ELECTRON_RUN_AS_NODE` trap).
- Release hygiene: conventional commits + changelog naming the artifact
  schemaVersion; `npm pack` inspection in CI (NOTICE present); publish
  0.1.0; PR to the Cypress plugins directory.
- The cy-prompt-anatomy write-up as a technical blog post ("we read the
  loader in the binary").

**Done when:** a fresh external project installs in two lines and heals a
real break; 0.1.0 is live.

## Post-v0.1 — already designed, inserted as stages

Full designs in [verification-ladder.md](plugins/verification-ladder.md).

- **Phase 2 — trust hardening:** `mutation-guard` (re-break the healed
  target; a heal that can't fail is a tautology), `snapshot-diff`
  (suite-level flipped-signal check), candidate fan-out (N proposals in
  isolated worktrees).
- **Phase 3 — adversarial gate:** `adversary` (independent refute-first
  model call), `review` (rubric-scored diff review), `regression-pin`
  (every delivered heal ships a replayable regression artifact).
- **Backlog** (see [blueprint](plugins/qa-relocator-blueprint.md)): heal
  memory (`healed-via-cache` tier), selector-flakiness telemetry,
  `--suggest-testids`, GitHub Action, Playwright capture shim.

## Testing strategy (held throughout, per packaging.md)

Unit tests for the Node side; jsdom for browser-side logic; the fixture
project as the system test (green-path job + broken-selector job asserting
a schema-valid artifact); a compatibility matrix (Cypress peer floor +
latest, plus a top-five-plugins-coexistence job); and the capture-rule
test as the permanent regression gate.

## Open decisions

| Decision | Owner | Needed by |
| --- | --- | --- |
| Name: goldseam vs regraft (org/scope/domain) | Adam | M0 publish, not code |
| Default heal model (Sonnet 5 for now; revisit with benchmark data) | M6 model axis | M7 |
| Cypress peer range floor (tested floor, honestly declared) | benchmark data | M7 |
| Redaction guarantees wording (schema doc is a public promise) | M1 review | M1 |
| Same-origin iframe capture: differentiator or documented wall | M6 cell | M6 |
| Heal-memory cache keying (selector × aria-identity) | Phase 2 | post-v0.1 |
