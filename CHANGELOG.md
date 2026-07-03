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
- Heal: `goldseam heal` — propose → rerun-test → rerun-spec ladder,
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
