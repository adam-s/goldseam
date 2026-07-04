# Changelog

All notable changes to the `goldseam` package. Conventional commits;
artifact schema versions are named per release (capture schema v1, heal
schema v1, prompt-cache schema v1).

## Unreleased

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
- Authoring: `cy.goldseam(steps, { placeholders })` — constrained command
  vocabulary, committable translation cache (`.goldseam-prompts/`),
  placeholder values never sent to the model, `goldseam eject`.
  Prompt-cache schema v1.
- CLI: `init` (one-command wiring), `report` (md/json per-test rows),
  `heal --only/--skip/--no-cache/--dry-run`.
- Benchmark: `scripts/benchmark.mjs` + `bench/mutations.json` — 4/4 with
  Sonnet across data-testid/id/class/text-assertion mutations.
