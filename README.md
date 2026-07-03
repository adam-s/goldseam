# goldseam

Self-healing for the test suites you already have. When a selector breaks,
the failure becomes a rich capture (DOM + accessibility tree + error); your
model — local or API, never a vendor cloud — proposes a minimal fix; the
suite verifies it; the repair arrives as a pull request.

Named for kintsugi: the repair is visible, reviewed, and part of the
object's story — never hidden magic.

> Working name. If the brand changes, `git grep -l goldseam` and one rename.

## Status

**M1 (capture) complete** — execution order lives in
[docs/plan.md](docs/plan.md). This repo holds:

- `packages/goldseam/` — the plugin: `goldseam/support` (fail-event stash,
  redaction, aria snapshot, never-mask re-throw) + `goldseam/plugin`
  (capture task → versioned artifacts in `.goldseam/failures/`) + the
  `goldseam` CLI shell (`heal`/`pr`/`report` land in M3+). Unit-tested
  (redaction, writer, capture-rule invariants) and system-tested (green
  runs stay quiet; a broken selector produces a schema-valid artifact).
- `packages/aria-snapshot/` — Playwright's aria snapshot (pure-DOM tree
  walk + YAML renderer) as a standalone package. Apache-2.0, attribution
  in NOTICE.
- `demo/` + `cypress/` — the demo-shop fixture (grows to full scenario
  coverage in M2) and the dogfood suite: this repo wires its own plugin
  exactly as a target project would. `npm run test:system` proves the
  loop.
- `docs/plugins/` — the Cypress plugin engineering knowledge base
  (extension points, paradigms, packaging bar, cy.prompt anatomy + usage
  catalog, product blueprint, verification ladder). Start with
  `docs/plugins/README.md`.
- `docs/cypress/` — Cypress platform internals learned while building the
  capture pipeline.

## Architecture (one line)

Collector → bridge → **artifact** → CLI: capture during the run, heal after
it, deliver as a PR. LLM calls live only in the CLI stage
(`goldseam heal`), behind a pluggable RepairRunner (`claude`, `openai:`,
`ollama:`, `cmd:`). Core model layer: Vercel AI SDK (`generateObject` +
schema); no agent framework in the product core.
