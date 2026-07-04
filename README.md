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

## What's in the repo

- `packages/goldseam/` — the plugin + CLI. `goldseam/support` captures
  failures (redacted DOM + accessibility tree + error) without ever
  masking one; `goldseam/plugin` writes versioned artifacts to
  `.goldseam/failures/`; `goldseam heal` runs the verification ladder —
  `triage → propose → resolve → oracle → rerun-test → rerun-spec` —
  behind a pluggable model runner, with mechanical edit validation and
  first-class give-up. Full docs in
  [packages/goldseam/README.md](packages/goldseam/README.md).
- `packages/aria-snapshot/` — Playwright's aria snapshot (pure-DOM tree
  walk + YAML renderer) plus targeting utilities, as a standalone
  package. Apache-2.0, attribution in NOTICE.
- `demo/` + `cypress/` — the demo-shop fixture and the dogfood suite:
  this repo wires its own plugin exactly as a target project would.
- `proving/` — real-world proving grounds (PrairieLearn, TodoMVC, Juice
  Shop, Shoelace, Cypress RWA): live apps, induced drift, real heals,
  honest give-ups. [proving/CAMPAIGN.md](proving/CAMPAIGN.md) has the
  receipts.
- `docs/plan.md` — the execution order; `.agents/reference/` — living
  design references (issue proofs, disambiguation catalog, verification
  ladder) plus agent playbooks under `.agents/skills/`.

Every push runs [the CI gauntlet](.github/workflows/ci.yml): unit +
package hygiene + four live-app suites + mutation smoke ("the suite must
bite") + a showcase job that breaks a selector and renders the heal in
the run summary. No model calls in CI — a deterministic stub stands in.

## Architecture (one line)

Collector → bridge → **artifact** → CLI: capture during the run, heal
after it, deliver as a reviewed diff. Model calls live only in the CLI
stage (`goldseam heal`), behind a pluggable RepairRunner — `claude` (the
Claude Code CLI) and `cmd:<executable>` (any program: prompt on stdin,
JSON out) today; HTTP runners planned. No agent framework in the product
core.
