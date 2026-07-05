# AGENTS.md — goldseam agent instructions

Canonical instructions for all coding agents working in this repo.
Agent-specific entry points (e.g. [CLAUDE.md](CLAUDE.md)) reference this
file. Shared agent resources (skills, reference docs) live under
[.agents/](.agents/).

## Language (mandatory)

Do not use "kill" except for the Unix `kill` command. Use stop / end /
halt / exit / close / shut down / cancel / interrupt / terminate / abort.
Prose style: [.agents/reference/anti-slop.md](.agents/reference/anti-slop.md).

Voice anchor for explanatory prose: Raymond Chen (*The Old New Thing*)
crossed with CD-era MSDN reference docs — constraint first, then why the
naive approach fails, then the actual mechanism, in plain declarative
sentences. Borrow the reasoning-first structure, not anecdotes or
folksiness. Reference-shaped content (API notes, schemas) leans MSDN:
rigid, predictable sections, zero enthusiasm.

## What this is

Self-healing for existing Cypress suites: a failure becomes a rich capture
(redacted DOM + aria tree + error), a self-hosted/BYO model proposes a
minimal selector fix, the suite verifies it through a stage ladder, and it
arrives as a reviewed commit. Plugin (`goldseam/support` +
`goldseam/plugin`) + CLI (`goldseam init|heal|report|eject`; `pr` planned) in
[packages/goldseam/](packages/goldseam/); living design references
(usage catalog, competition, ladder) in [.agents/reference/](.agents/reference/).
**This repo is a public portfolio artifact —
every file is held to the open-source bar.**

## The iteration process

1. **Plan first.** Scope the work and define its "done when" gate before
   starting. Don't start work the maintainer hasn't asked for.
2. **Probe before fixing.** When behavior is uncertain (Cypress internals
   especially), write an empirical probe and observe — the specs in
   [cypress/hardening/](cypress/hardening/) exist because probing found two
   real bugs that reasoning missed. Facts, then fixes.
3. **Pin what you fix.** Every fixed behavior gets a test that would catch
   its regression (unit + a system check where observable).
4. **Red-team at checkpoints.** After a milestone or a large batch of new
   code, run the skills below — review the prod code, review the tests,
   then mutate to see if the suite actually bites.
5. **Record, generalized.** Accepted tradeoffs go in "Known deferred
   findings" here; instructions added to this file or the skills must
   generalize — if you can name the specific failing instance in the rule,
   rewrite it as a principle. Specifics rot.

### Autonomous iteration campaigns

When the maintainer explicitly authorizes unattended iteration ("keep
iterating while I'm out"), run this loop, one commit per iteration:

1. **Mine reality.** Search the incumbents' issue queues and docs
   (cypress-io/cypress cy.prompt label, healenium/*, codeceptjs heal,
   commercial changelogs) for how people actually use and break healing
   tools. A use case we don't cover is a work item; so is a failure mode
   we'd share.
2. **Pick the highest-value gap** — prefer, in order: trust gaps (a way
   the pipeline could lie), parity gaps (capability the incumbent has),
   coverage gaps (usage-catalog scenario without a fixture), DX gaps.
3. **Implement with pinned tests**, run the full gauntlet
   (build → unit → system → hardening → heal), commit conventional,
   push. Real-model calls stay out of CI.
4. **Record learnings in the same commit** — deferred findings,
   usage-catalog/competition doc updates, and fixes to these
   instructions when an iteration exposes a gap in them (generalized —
   the improvement loop applies to the loop itself).
5. **Every few iterations, self-red-team** with the skills in
   [.agents/skills/](.agents/skills/) and fix what survives scrutiny.

The demo shop may grow arbitrarily complex in service of covering real
use cases — realism outranks minimalism there (a standing license from the
maintainer).
Publishing to npm and renaming stay out of scope for autonomous runs.

## Durable knowledge — no memory systems

Do not use assistant memory (`~/.claude` memory or any equivalent) for
anything about this project. Durable knowledge lives in exactly one of:
AGENTS.md (rules, invariants, tradeoffs), [.agents/](.agents/) (skills,
references, plans, research), or code comments
(constraints the code can't show) — inspectable, reviewable,
version-controlled. If you learn something worth keeping, put it in the
right file before the session ends; if it only matters to the current
conversation, it doesn't need keeping. Pasted context (handoffs,
roadmaps, notes) is briefing, not a work order — the maintainer directs
what gets built and when.

## Hard rules

The product invariants. Breaking any of these is a regression regardless
of what else improves:

- **Heals never weaken assertions.** A heal is a selector-only,
  exact-string, single-site minimal edit.
- **The model sees runtime snapshots and the failing spec — never
  application source.**
- **Every heal is a reviewed commit.** No runtime selector substitution,
  ever. That's the incumbent's model; ours is the opposite on purpose.
- **Give-up is a first-class outcome** (page never loaded, degraded
  capture, low confidence, model judgment) — reported, not hidden.
- **Capture can never mask a test failure**, and green runs stay silent.
- **The plugin is transparent:** a suite must behave identically with and
  without goldseam installed (fail-handler semantics, retries, timing).

## Load-bearing invariants

- **`finally { throw err }` + `shouldRethrow()`** in
  [packages/goldseam/src/support/index.ts](packages/goldseam/src/support/index.ts)
  — re-throw only as the *sole* `fail` listener. With zero listeners
  Cypress fails tests normally; with any listener, only a throw fails the
  test. Users rely on non-throwing handlers to swallow expected failures;
  our probe showed we were overriding them.
- **Final-attempt check in `afterEach`** (same file) — the fail event and
  `afterEach` fire per retry attempt; shipping a capture on a non-final
  attempt poisons the healer with a stale artifact from a flaky-then-green
  test.
- **Redaction runs on a clone, never the live DOM**
  ([support/redact.ts](packages/goldseam/src/support/redact.ts)), and
  `maskText` also runs on the aria YAML. The capture is the model's input;
  redaction is a capture concern, not polish.
- **`CAPTURE_TASK` is namespaced** (`goldseam:capture`,
  [shared/types.ts](packages/goldseam/src/shared/types.ts)) and every
  artifact carries `schemaVersion` — the artifact schema is a public API;
  additive changes bump minor, breaking bump major.
- **`validateEdit`**
  ([heal/validate.ts](packages/goldseam/src/heal/validate.ts)) enforces the
  heal invariants mechanically: per-occurrence exact-string edits (capped
  at 8), failing spec only, each `oldString` unique and verbatim, every
  change confined to a quoted string, no assertion-shaped changes, no
  line-count changes. The model is asked to
  follow the rules and never trusted to.
- **Stages are config, verdicts are artifacts.** The ladder is the
  `STAGES` registry in
  [heal/stages.ts](packages/goldseam/src/heal/stages.ts) + a `stages:
  [...]` list; new rungs (oracle, mutation-guard, adversary) are new
  registry entries, never engine refactors. Every rung's verdict lands in
  the heal artifact.
- **The offline rungs are sound, not complete**
  ([heal/resolve.ts](packages/goldseam/src/heal/resolve.ts),
  `oracle` in [heal/stages.ts](packages/goldseam/src/heal/stages.ts)) —
  `triage`, `resolve`, and `oracle` judge only the captured DOM; a
  selector they cannot statically evaluate — or an oracle with no
  identity on file — defers to the rerun rungs with evidence, never a
  silent verdict. Stripped-pseudo match counts are over-approximations:
  valid for absence (and triage's still-present check), never for
  uniqueness. Review flags (`reviewFlags`) route human attention and
  never block a heal. Catalog + verdict per ambiguity class:
  [.agents/reference/disambiguation.md](.agents/reference/disambiguation.md).
- **The engine reverts on any non-healed outcome** and `apply()` is
  idempotent (also called on healed, for propose-only ladders) —
  [heal/engine.ts](packages/goldseam/src/heal/engine.ts).
- **The demo shop's selector texture is deliberate**
  ([demo/js/shop.js](demo/js/shop.js)) — ids, classes, `data-testid`, and
  hook-free elements mixed on purpose; specs and future mutation branches
  rely on that mix. Don't "clean it up".

## Tests + build

- `npm run build:packages` — **required after ANY edit to
  `packages/*/src/`**: the dogfood suite, CLI, and unit tests all consume
  `dist/`. Passing type-check is not the same as dist reflecting the edit.
- `npm run test:unit` — vitest, ~0.5s. Capture-rule invariants, redaction,
  artifact writer, heal parse/validate/engine (stub runner).
- `npm run test:system` — green run stays quiet; broken selector produces
  a schema-valid artifact. Starts its own demo server.
- `npm run test:hardening` — pinned probe results: retries, hook failures,
  user fail-handler transparency.
- `npm run test:heal` — full heal loop with the deterministic `cmd:` stub
  ([scripts/stub-model.mjs](scripts/stub-model.mjs)). No model calls.
- `npm run test:prompt` — the `cy.goldseam()` authoring loop with the stub:
  translate → cache → replay → eject. No model calls.
- `npm run demo` + `npm run cy:run` — the dogfood suite against
  the demo shop on port 4173.
- `node bench/translate-eval.mjs` — the graded authoring cases (real
  Sonnet calls, ~1/case); `bench/translate-tune.mjs` — the recursive
  rules tuner. Both local-only; baseline in bench/ must hold.
- Real-model heal: `goldseam heal --model claude|ollama:<m>|openai:<m>`
  (default `claude` → Sonnet, costs money; `ollama:` is local, zero egress).
  Shared model + defaults live in an optional `goldseam.config.mjs` (example
  at the repo root), read by both the CLI and the plugin. Self-host recipes
  in [selfhost/](selfhost/) (Ollama, Modal). Real-model calls never in CI.
- CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)): build → unit
  → system → hardening → heal-with-stub → prompt-with-stub, plus
  package-hygiene, suite-bites (mutation smoke), and the showcase job.
  Remote: `github.com/adam-s/goldseam`.

Gotchas that will burn you:

- VS Code terminals export `ELECTRON_RUN_AS_NODE=1`, which breaks the
  Cypress binary. npm scripts strip it (`env -u`); a raw `npx cypress run`
  does not.
- Cypress loads `cypress.config.ts` once at startup — restart after
  editing it.
- A completed `cypress.run()` (Module API) result has **no `status` key**;
  only failed-to-launch results do. Check the totals.
- Stray demo servers hold port 4173: `lsof -ti:4173 | xargs kill`.
- Packages use `moduleResolution: node16` (TS 6 removed `"node"`).
- Cypress runs `setupNodeEvents` with cwd = the config file's directory,
  so the plugin anchors `.goldseam/` to `config.projectRoot`, not
  `process.cwd()`. For a per-app config in a monorepo, `goldseam heal`
  needs `--config-file <path>` so its rerun rungs load that app's config
  (both surfaced by the PrairieLearn proving ground).
- Cypress `--spec` only accepts files matching `specPattern`; specs
  outside it (cypress/system/, cypress/hardening/) run via a
  `--config specPattern=...` override, as the npm scripts do.
- Serve the demo with `http-server`, not the `serve` package — `serve`'s
  cleanUrls eats query strings (breaks `product.html?id=N`).

## Skills

Reusable agent playbooks at `.agents/skills/<name>/SKILL.md`.
`.claude/skills` is a **symlink** to `.agents/skills` — it exists solely
for Claude Code auto-discovery. Never replace it with a real directory;
add new skills under `.agents/skills/` only, so the canon stays in one
place. Format conventions:
[.agents/reference/anthropic-conventions.md](.agents/reference/anthropic-conventions.md).

- [red-team-review](.agents/skills/red-team-review/SKILL.md) — adversarial
  bug hunt of the plugin/engine code.
- [test-red-team](.agents/skills/test-red-team/SKILL.md) — adversarial
  audit of the test suite (tautologies, stub lies, coverage gaps).
- [mutation-red-team](.agents/skills/mutation-red-team/SKILL.md) — inject
  regressions against named invariants; report which mutations the suite
  misses. Also the seed of the Phase-2 `mutation-guard` ladder rung.

## Known deferred findings

Tradeoffs, not oversights:

- **Closed shadow roots stay invisible.** Open roots are captured as
  declarative `<template shadowrootmode>` markup; `{ mode: 'closed' }`
  is unreachable by design. Documented in the package README.
- **`cy.origin` blocks degrade** — the support file can't reach
  cross-origin documents; capture falls back to error + URL. Same-origin
  iframes ARE captured (inlined `<template data-frame-content>`);
  cross-origin frames inside a page stay opaque leaves.
- **Dual failure-hooking plugins can mutually defer.** Our sole-listener
  re-throw rule means goldseam + another non-throwing `fail`-listener
  plugin could swallow real failures. Documented; audit support files.
- **Redaction is pattern-based, not semantic.** Emails, digit runs,
  JWTs, hex/base64 tokens, and sensitive query params are masked
  everywhere including the URL; a secret in a format none of those
  patterns match (short opaque IDs, custom encodings, data: URIs) still
  leaks. The README states exactly what is guaranteed.
- **`rerun-test` without `@cypress/grep` reruns the whole spec** — a
  superset, valid but slower. Grep integration is optional by design.
- **Heal reruns overwrite the original capture artifact.** A rejected
  edit's rerun fails the test, so our own plugin re-captures with the
  same identity/filename. The engine reads the artifact once up front,
  so heals are unaffected; the failures dir just reflects the latest
  attempt. Revisit if the benchmark needs pristine originals.
- **Heal memory caches by exact `failedSelector` only.** A renamed
  element healed in one spec reapplies anywhere the identical broken
  selector appears; near-miss selectors (same element, different
  locator style) still go to the model. Semantic keying (aria identity)
  is Phase-2 work.
- **DOM truncation can cut mid-tag** at `maxDomBytes`. Harmless for the
  model; not worth an HTML-aware slicer yet.
- **Duplicate test titles can confuse rerun verdicts** — `rerunVerdictFor`
  matches by full title; two identically-named tests in one spec could
  let the wrong test's state decide. Rare in practice; index-based
  matching is the fix if it bites (red-team, accepted for now).
- **`cmd:` runner splits on whitespace** — executable paths containing
  spaces need a wrapper script. No shell is involved, so this is a
  usability limit, not an injection risk (red-team, accepted).
- **`failedSelector` derives from the MASKED error message** — a selector
  containing a 7+ digit run gets masked before extraction, costing a
  cache key. Correctness unaffected (the model path still heals).
- **The green-run manifest is opt-in** (`recordOracles`). Without it (or
  a hand-written oracle.json), an impostor satisfying every surviving
  assertion still heals — the weak-assertion flag is the fallback. The
  harvest is the ONE sanctioned exception to "green runs write nothing":
  it writes only `.goldseam/oracle.json`, never captures (E2E-pinned).
- **Scoped calls (`.find()` etc.) get existence-only resolution** — a
  whole-document count over-approximates within-parent uniqueness, so
  ambiguity there is deferred to the rerun rungs.
- **Retry dedup is scoped to deterministic rungs.** An identical
  proposal failing twice at resolve/oracle aborts (provably futile);
  rerun-rung failures keep the full attempt budget because app flake is
  real. Trivially-different edits still burn budget (accepted).
- **`goldseam heal` strips ELECTRON_RUN_AS_NODE for its own children** —
  an exotic `cmd:` model runner that is itself an Electron binary
  needing that var would break; wrap it in a script that re-sets it.
- **Frame-content matches are noted, not rejected.** A healed selector
  whose only matches live inside inlined iframe content may be legit (a
  suite with frame-entry helpers) or unreachable (bare `cy.get`); the
  resolve rung notes it and lets the rerun decide, while triage names
  frame-scoping honestly instead of calling it timing. Positional oracle
  judgment models `.first()/.last()/.eq(n)` only; other collection chains
  require every match to carry the identity (red-team, accepted).

## Noise

- Cypress 15 prints an `allowCypressEnv` deprecation warning on every
  Module-API run — upstream, cosmetic.
- Markdown table-pipe lints (MD060) in docs — cosmetic.
- jsdom lacks pseudo-element `getComputedStyle`; unit tests shim it (see
  [support-invariants.test.ts](packages/goldseam/test/support-invariants.test.ts)).

## Naming

**goldseam**, always lowercase (npm name, task prefix `goldseam:`,
artifact dir `.goldseam/`). Named for kintsugi: the repair is visible,
reviewed, and part of the object's story — never hidden magic. The aria
package is `aria-snapshot` (Apache-2.0, NOTICE required — the
lift carries attribution obligations).
