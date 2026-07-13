# Changelog

Notable changes to this repo's published packages (`goldseam`,
`aria-snapshot`). Conventional commits; artifact schema versions are named
per release (capture schema v1, heal schema v1, prompt-cache schema v1).

The `0.0.x` versions on npm are pre-release development snapshots and are not
separately catalogued here; the first stable release will be `0.1.0`.
Everything below is unreleased work toward it.

## Unreleased

- Heal internals: `parseDom` consumers (triage, resolve, oracle, the prompt
  window) now release their jsdom window through `closeWindow`/`withParsedDom`
  after the last read — correct lifecycle and a guard against a future
  tight-loop caller OOMing. Behavior-neutral (counts and verdicts are computed
  before release). A measured leak audit found no unbounded growth in the
  engine; the offline text-match helpers' O(N × subtree) cost on giant DOMs
  and the oracle rung's aria-walk scaling are recorded as accepted, deferred
  findings.
- Heal: **`heal.exclude` directive** — a committed, reviewed guarantee that
  goldseam never heals a deliberately-red test (a security/negative assertion,
  a regression the team is tracking, a quarantined flake). Config
  (`heal.exclude`, a durable list) or `--exclude <substr>` (one-off). A bare
  string substring-matches spec-or-title; an object ANDs `spec`/`title`/
  `selector` with an optional `reason`. Unlike `--skip` (a silent drop), an
  exclusion produces a first-class, REPORTED give-up (`tier: excluded`) with
  the reason in the ladder — short-circuited in the engine before any model
  call, so an excluded test is never sent to the model and its spec is never
  touched. Incumbent parity (Healenium `@DisableHealing`; cy.prompt has no
  opt-out), and beats their disable leaking through `findElements`.

- Capture (security): the **aria snapshot no longer leaks text-control
  values**. The DOM path stripped text-entry/`textarea` values, but the aria
  path went through `maskText` (pattern-masking) only, so a typed value
  matching no pattern — a password, a name — shipped to the model as
  `textbox "Pw": <value>`. `stripAriaControlValues` now removes the inline
  value (keeping role + accessible name) before masking, restoring the
  documented "text-entry values are never captured" guarantee on both
  surfaces.
- Heal `resolve` rung: **scoped `.find()` uniqueness**. A whole-document
  count is existence-only for scoped calls, so a heal to a look-alike sibling
  inside a parent scope could pass offline. Now, for the direct
  `cy.get('P').find('C')` shape where `P` resolves to exactly one element, the
  rung counts `C` *within* that element and rejects a within-parent ambiguity
  — the incumbents' cardinal "heals to the next element of the same type"
  failure, caught offline. Sound, not complete: any other shape (chained
  parent, `.within()`, variable subject, jQuery-pseudo child) defers to the
  rerun, so an over-approximation never rejects.
- Heal prompt: an anchored **neighborhood window**
  (`heal/dom-window.ts`) so a deep target survives the ~40 K prompt budget.
  Style/script bodies are emptied; then, when the DOM still overflows and a
  head-first slice shows no anchor, a page *region* is emitted around an
  anchor tied to the failure — asserted spec text first, then a surviving
  distinctive sub-part of the broken selector, descending into
  open-shadow / inlined-frame `<template>`s for parity with resolution.
  Prompt-only: resolution reads the untouched capture, so match counts never
  change. Regression-proof gate (unchanged behavior whenever a head-first
  slice already shows an anchor), content-neutral within the window (every
  attribute/text preserved, scaffold values escaped), hard-bounded output,
  and a widened fallback when no anchor exists at all. Proven live: real
  Sonnet healed drifted selectors on Framer (whereby.com) and Webflow pages
  whose targets sit far past the budget — cases a head-first slice gives up
  on.
- Heal: `--dry-run` no longer persists the heal artifact — it previews the
  full ladder to stdout but must not overwrite a prior real heal artifact.
- Capture: fail-event pipeline with redaction (emails, digit runs, JWTs,
  hex/base64 tokens, sensitive query params, capture URL), open-shadow-DOM
  serialization, retry-awareness, transparency toward user fail handlers,
  honest `cy.origin` degradation, `failedSelector` derivation, atomic
  artifact writes. Capture schema v1.
- Targeting (`aria-snapshot` 0.2.0): the aria tree as an addressing
  space — `queryAllDeep`, `expandSerializedTemplates`, `deriveSelector`
  (element → best unique native selector, priority-ordered,
  uniqueness-verified); `{ frames: true }` descends same-origin iframes;
  the walk traverses serialized captures (declarative shadow templates +
  the `<template data-frame-content>` iframe convention).
- Capture: same-origin iframe documents inlined as sibling
  `<template data-frame-content>` markup, redacted like everything else;
  the aria snapshot nests frame content under its `iframe` node.
  Cross-origin frames and closed shadow roots remain honest walls.
- Runner matrix: `ollama:<model>` (local HTTP, zero egress,
  JSON-constrained decoding) and `openai:<model>` (any OpenAI-compatible
  endpoint via OPENAI_BASE_URL/OPENAI_API_KEY — Modal/vLLM serve, LM
  Studio, OpenAI). Parse leniency for smaller models, strictness kept:
  stringified confidence coerced, metadata nested inside edits hoisted;
  repair prompt teaches the unquoted CSS attribute form. Proved: local
  Qwen 2.5 14B healed an id drift through the full six-rung ladder; the
  `openai:` runner proven end-to-end against real OpenAI (gpt-4o-mini:
  request → response → JSON-block parse). A copy-paste Modal self-host
  recipe lives in `selfhost/modal/` (deploy unproven in CI, which makes no
  cloud calls).
- Config: optional `goldseam.config.mjs` at the project root, read by both
  the CLI and the plugin, sets the model — and heal/author defaults — in
  one committable, reviewable place instead of split across a CLI flag and
  a plugin option. Precedence: CLI flag / plugin option > env
  (`GOLDSEAM_MODEL`, `GOLDSEAM_PROMPT_MODEL`) > config file > built-in
  default. Secrets stay in env. `.mjs` so the standalone CLI loads it with
  no bundler.
- Green-run identity manifest (`recordOracles`, opt-in): passing tests
  record each `cy.get` selector's aria identity (role + accessible name)
  into `.goldseam/oracle.json` — the oracle rung then rejects any heal
  that abandons the identity a selector had while green. The one
  sanctioned exception to "green runs write nothing" (manifest only,
  never captures). Support options also merge from Cypress env
  `goldseam`.
- Heal guards (the disambiguation catalog,
  `.agents/reference/disambiguation.md`): `triage` (a "missing" selector
  still matching the capture is timing, not drift — give up before any
  model call), `resolve` (healed selector must exist and be unambiguous
  in the captured DOM, offline, before any rerun), `oracle` (healed
  selector must land on the known-good aria identity from
  `.goldseam/oracle.json` — the impostor guard), weak-assertion
  `reviewFlags` on heal artifacts (⚠ in CLI, Flags column in report).
- Heal: `goldseam heal` — triage → propose → resolve → oracle →
  rerun-test → rerun-spec ladder,
  mechanical edit validation (per-occurrence exact-string edits,
  context-aware assertion guard), hard attempt cap with feedback,
  first-class give-up, heal memory cache tier, sibling-heal detection,
  test-level rerun verdicts. Heal schema v1. Runners: `claude`,
  `claude:<model>`, `cmd:<executable>`.
- Authoring honesty (live-site proving): ambiguous or vague steps are
  REFUSED, never guessed — the model replies `giveUp`, the refusal is
  cached (deterministic replays, zero model calls), and the failure names
  the ambiguity. Translation selectors must be copied from the provided
  page HTML; expectations about not-yet-rendered elements become
  text-contains asserts; the DOM budget is spent on body markup
  (head/script/style stripped). Shadow-scoped interactions via the
  `shadow` host field.
- Authoring: `cy.goldseam(steps, { placeholders })` — constrained command
  vocabulary, committable translation cache (`.goldseam-prompts/`),
  placeholder values never sent to the model, `goldseam eject`.
  Prompt-cache schema v1.
- CLI: `init` (one-command wiring), `report` (md/json per-test rows),
  `heal --only/--skip/--no-cache/--dry-run`.
- Benchmark: `scripts/benchmark.mjs` + `bench/mutations.json` — 4/4 with
  Sonnet across data-testid/id/class/text-assertion mutations.
