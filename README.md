# goldseam

Self-healing for the test suites you already have. When a selector breaks,
the failure becomes a rich capture (DOM + accessibility tree + error); your
model — local or API, never a vendor cloud — proposes a minimal fix; the
suite verifies it; the repair arrives as a pull request.

Named for kintsugi: the repair is visible, reviewed, and part of the
object's story — never hidden magic.

> Working name. If the brand changes, `git grep -l goldseam` and one rename.

## Status

Pre-code. This repo currently holds:

- `docs/plugins/` — the Cypress plugin engineering knowledge base
  (extension points, paradigms, packaging bar, cy.prompt anatomy, product
  blueprint). Start with `docs/plugins/README.md`.
- `docs/cypress/` — Cypress platform internals (frame architecture,
  comms channels, proxy/origin mechanics) learned while building the
  capture pipeline.
- `packages/aria-snapshot/` — the one code asset carried over:
  Playwright's aria snapshot (pure-DOM tree walk + YAML renderer) as a
  standalone package. Apache-2.0, attribution in NOTICE.

Prototype and provenance: the capture pipeline (fail-event stash →
`cy.task` → guarded JSON artifacts) was built and verified in the
`qa-relocator` teaching repo; it migrates here as the plugin core.

## Architecture (one line)

Collector → bridge → **artifact** → CLI: capture during the run, heal after
it, deliver as a PR. LLM calls live only in the CLI stage
(`goldseam heal`), behind a pluggable RepairRunner (`claude`, `openai:`,
`ollama:`, `cmd:`). Core model layer: Vercel AI SDK (`generateObject` +
schema); no agent framework in the product core.
