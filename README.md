# goldseam

[![CI](https://github.com/adam-s/goldseam/actions/workflows/ci.yml/badge.svg)](https://github.com/adam-s/goldseam/actions/workflows/ci.yml)

Self-healing for the test suites you already have. When a selector breaks,
the failure becomes a rich capture (DOM + accessibility tree + error); your
model — local or API, never a vendor cloud — proposes a minimal fix; the
suite verifies it; the repair arrives as a pull request.

Named for kintsugi: the repair is visible, reviewed, and part of the
object's story — never hidden magic.

> Published on npm 2026-07-03: [`goldseam`](https://www.npmjs.com/package/goldseam)
> (plugin + CLI) and [`aria-snapshot`](https://www.npmjs.com/package/aria-snapshot)
> (the standalone helper). The name is final.

## Status

**M1–M4 complete: the heal loop works end to end** (real heal verified
with Sonnet 5 via `claude -p`). Execution order lives in
[docs/plan.md](docs/plan.md). This repo holds:

- `packages/goldseam/` — the plugin + CLI: `goldseam/support` (fail-event
  stash, redaction, aria snapshot, never-mask re-throw, retry-aware,
  transparent to user fail handlers) + `goldseam/plugin` (capture task →
  versioned artifacts in `.goldseam/failures/`) + `goldseam heal` (the
  Phase-1 ladder: `triage → propose → resolve → rerun-test → rerun-spec`
  behind a pluggable
  RepairRunner, hard attempt cap, mechanical edit validation, first-class
  give-up; `pr` lands in M5). 123 unit tests + three system suites
  (capture, hardening, heal E2E with a stub model).
- `packages/aria-snapshot/` — Playwright's aria snapshot (pure-DOM tree
  walk + YAML renderer) as a standalone package. Apache-2.0, attribution
  in NOTICE.
- `demo/` + `cypress/` — the demo-shop fixture (grows to full scenario
  coverage in M2) and the dogfood suite: this repo wires its own plugin
  exactly as a target project would. `npm run test:system` proves the
  loop.
- `docs/plan.md` — the execution order; `.agents/reference/` — the living
  design references (usage catalog, competition landscape, verification
  ladder, disambiguation catalog) plus agent playbooks under
  `.agents/skills/`.

## Architecture (one line)

Collector → bridge → **artifact** → CLI: capture during the run, heal after
it, deliver as a PR. LLM calls live only in the CLI stage
(`goldseam heal`), behind a pluggable RepairRunner (`claude`, `openai:`,
`ollama:`, `cmd:`). Core model layer: Vercel AI SDK (`generateObject` +
schema); no agent framework in the product core.
