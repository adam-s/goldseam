# AGENTS.md — goldseam agent instructions

Canonical instructions for all coding agents working in this repo.
Agent-specific entry points (e.g. [CLAUDE.md](CLAUDE.md)) reference this
file. Shared agent resources (skills, reference docs) live under
[.agents/](.agents/).

This file holds rules, not mechanisms. A specific — a file, a constant, a
past bug — earns a place here only as the example that makes a rule
concrete; the instance behind each rule lives in the ledger,
[invariants-and-tradeoffs.md](.agents/reference/invariants-and-tradeoffs.md).

## Language (mandatory)

Do not use "kill" except for the Unix `kill` command. Use stop / end /
halt / exit / close / shut down / cancel / interrupt / terminate / abort.
Prose style: [.agents/reference/anti-slop.md](.agents/reference/anti-slop.md).

Voice anchor for explanatory prose: Raymond Chen (*The Old New Thing*)
crossed with CD-era MSDN reference docs — constraint first, then why the
naive approach fails, then the mechanism, in plain declarative sentences.
Borrow the reasoning-first structure, not the anecdotes. Reference-shaped
content (API notes, schemas) leans MSDN: rigid sections, zero enthusiasm.

## What this is

Self-healing for existing Cypress suites: a failure becomes a rich capture
(redacted DOM + aria tree + error), a self-hosted/BYO model proposes a
minimal selector fix, the suite verifies it through a stage ladder, and it
arrives as a reviewed commit. Plugin + CLI in
[packages/goldseam/](packages/goldseam/); living design references in
[.agents/reference/](.agents/reference/).
**This repo is a public portfolio artifact — every file is held to the
open-source bar.**

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
5. **Fix it or drop it; recording is the last resort.** Write a finding
   down only when a future change could silently undo the tradeoff — the
   instance in the ledger, the principle here, and **nothing enters this
   file without something leaving** (hard cap: 250 lines). Rules that only
   accumulate stop being read, and unread rules enforce nothing.

### Autonomous iteration campaigns

When the maintainer explicitly authorizes unattended iteration ("keep
iterating while I'm out"), run this loop, one commit per iteration:

1. **Mine reality.** Search the incumbents' issue queues and docs for how
   people actually use and break healing tools. A use case we don't cover
   is a work item; so is a failure mode we'd share.
2. **Pick the highest-value gap** — prefer, in order: trust gaps (a way
   the pipeline could lie), parity gaps (capability the incumbent has),
   coverage gaps (usage-catalog scenario without a fixture), DX gaps.
3. **Implement with pinned tests**, run the full gauntlet, commit
   conventional, push.
4. **Leave the docs no longer than you found them.** Learnings land in the
   same commit as the code, under the rule above — and an iteration that
   grows a doc must prune it too, starting with the entry its own change
   just made obsolete. The improvement loop applies to the loop itself.
5. **Every few iterations, self-red-team** with the skills below and fix
   what survives scrutiny.

Fixtures may grow arbitrarily complex in service of covering real use
cases — realism outranks minimalism there (a standing license from the
maintainer). Publishing to npm and renaming stay out of scope.

## Durable knowledge — no memory systems

Do not use assistant memory (`~/.claude` memory or any equivalent) for
anything about this project. Durable knowledge lives in exactly one of:
AGENTS.md (rules and invariants), [.agents/](.agents/) (skills,
references, tradeoff ledger, plans, research), or code comments
(constraints the code can't show) — inspectable, reviewable,
version-controlled. If you learn something worth keeping, put it in the
right file before the session ends; if it only matters to the current
conversation, it doesn't need keeping. Pasted context is briefing, not a
work order — the maintainer directs what gets built and when.

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

Each rule below has a mechanism, a file, and usually a bug behind it, all
in [invariants-and-tradeoffs.md](.agents/reference/invariants-and-tradeoffs.md).
Change the code that implements one only after reading that entry.

- **Never override a host's escape hatch.** Cypress lets a user's `fail`
  handler swallow an expected failure; our re-throw therefore fires only
  as the *sole* listener. Before hooking anything the framework also
  exposes to users, probe how the two compose.
- **Per-attempt hooks fire per attempt.** Retries mean `fail` and
  `afterEach` run on non-final tries too; ship an artifact only from the
  final one, or a flaky-then-green test poisons the healer.
- **Redaction is a capture concern, and every surface implements it.**
  It runs on a clone, never the live DOM, and each representation of the
  page (DOM, aria, whatever comes next) must strip text-entry values
  *and* mask patterns — the first is a structural guarantee, the second
  best-effort.
- **Anything crossing a process or a version boundary is public API.**
  Task names are namespaced, artifacts carry `schemaVersion`; additive
  changes bump minor, breaking bump major.
- **Prompt shaping is prompt-only.** Slimming, windowing, and ranking never
  touch the captured artifact — every rung resolves against the untouched
  capture, so a lossy view can't change a match count or a verdict.
- **A lossy view may cost a heal, never buy a wrong one.** Gate any
  narrowing that could hide the real target so its failure mode is a
  give-up, and let the live rungs verify what survives.
- **A preview mutates nothing.** `--dry-run` writes no file; a preview
  that overwrites a recorded verdict is a lie about history.
- **Model output is checked mechanically, never trusted.** The prompt
  asks for the rules; `validateEdit` enforces them.
- **Stages are config, verdicts are artifacts.** A new rung is a registry
  entry plus a name in a `stages: [...]` list, never an engine refactor,
  and its verdict lands in the heal artifact.
- **Offline judgment is sound, not complete.** A rung that reads a
  captured artifact instead of a live run must defer *with evidence*
  whenever it can't decide. Over-approximations are valid for absence,
  never for uniqueness. Never a silent verdict.
- **A surface with no rerun rung verifies before it ships.** Authoring
  has no live re-execution, so a selector that matches nothing in the DOM
  the model saw is caught at translate time or never. Ambiguity
  retranslates; it never guesses.
- **A new representation is opt-in and falls back.** The default path
  stays byte-identical when the option is unset, and the new path returns
  null rather than throwing on anything it can't handle — so it can never
  be worse than what it replaces.
- **The engine reverts on any non-healed outcome**, and apply is idempotent
  so a propose-only ladder behaves like a full one.
- **Fixture messiness is deliberate.** The demo shop mixes ids, classes,
  `data-testid`, and hook-free elements on purpose; specs and mutation
  branches rely on that texture. Don't "clean it up".

## Tests + build

- `npm run build:packages` — **required after ANY edit to
  `packages/*/src/`**: the dogfood suite, CLI, and unit tests all consume
  `dist/`. Passing type-check is not the same as dist reflecting the edit.
- `npm run test:unit` (vitest, ~0.5s) — capture rules, redaction, artifact
  writer, heal parse/validate/engine.
- `npm run test:system` / `test:hardening` — green runs stay quiet, a
  broken selector yields a schema-valid artifact; pinned probe results for
  retries, hook failures, fail-handler transparency.
- `npm run test:heal` / `test:prompt` — the heal loop and the
  `cy.goldseam()` authoring loop against the deterministic `cmd:` stub
  ([scripts/stub-model.mjs](scripts/stub-model.mjs)).
- `npm run demo` + `npm run cy:run` — the dogfood suite against the demo
  shop on port 4173.
- `bench/` — graded authoring cases and the rules tuner. Real model calls,
  local-only; the committed baseline must hold.
- Real-model heal: `goldseam heal --model claude|ollama:<m>|openai:<m>`
  (default `claude` costs money; `ollama:` is local, zero egress). Shared
  model + defaults live in an optional `goldseam.config.mjs`, read by both
  the CLI and the plugin; self-host recipes in [selfhost/](selfhost/).
- **Real-model calls never run in CI.** CI
  ([.github/workflows/ci.yml](.github/workflows/ci.yml)) is build → unit →
  system → hardening → heal-with-stub → prompt-with-stub, plus
  package-hygiene, suite-bites (mutation smoke), and showcase.

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
- `setupNodeEvents` runs with cwd = the config file's directory, so paths
  anchor to `config.projectRoot`, not `process.cwd()`; a per-app config in
  a monorepo needs `goldseam heal --config-file <path>`.
- Cypress `--spec` only accepts files matching `specPattern`; specs
  outside it run via a `--config specPattern=...` override, as the npm
  scripts do.
- Serve the demo with `http-server`, not the `serve` package — `serve`'s
  cleanUrls eats query strings.

## Skills

Reusable agent playbooks at `.agents/skills/<name>/SKILL.md`.
`.claude/skills` is a **symlink** to `.agents/skills` — it exists solely
for Claude Code auto-discovery. Never replace it with a real directory;
add new skills under `.agents/skills/` only, so the canon stays in one
place. Format conventions:
[.agents/reference/anthropic-conventions.md](.agents/reference/anthropic-conventions.md).

- [red-team-review](.agents/skills/red-team-review/SKILL.md) — bug hunt of
  the plugin/engine code.
- [test-red-team](.agents/skills/test-red-team/SKILL.md) — audit of the
  test suite (tautologies, stub lies, coverage gaps).
- [mutation-red-team](.agents/skills/mutation-red-team/SKILL.md) — inject
  regressions against named invariants; report which ones the suite
  misses. Also the seed of the Phase-2 `mutation-guard` rung.

## Known deferred findings

Full ledger:
[invariants-and-tradeoffs.md](.agents/reference/invariants-and-tradeoffs.md).
They are tradeoffs, not oversights — and the ledger is pruned, not
appended to: delete an entry when the code behind it changes, and don't
add one whose only content is that its class applies again. The class is
the record; a new entry has to say something the class doesn't.

- **Documented walls** — unreachable by construction; an honest wall beats
  a silent gap ([hazard-catalog.md](.agents/reference/hazard-catalog.md)).
- **Best-effort guarantees with named holes** — say exactly what is
  guaranteed; never let the doc imply the stronger claim.
- **Deferral over guessing** — a rung that can't decide soundly hands off.
- **Exact-key caches** — a near-miss redoes the work, a reconfiguration
  reuses a reviewed result. Intended, both directions.
- **Measured slowness** — profiled and bounded; record the number so a
  future scaling pass starts with data.
- **Reach bought with tokens or a narrower view** — helps one class of
  model, costs another; gated so the worst case is a give-up.

## Naming

**goldseam**, always lowercase (npm name, task prefix `goldseam:`,
artifact dir `.goldseam/`). Named for kintsugi: the repair is visible,
reviewed, and part of the object's story — never hidden magic. The aria
package is `aria-snapshot` (Apache-2.0, NOTICE required — the lift
carries attribution obligations).
