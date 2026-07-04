# goldseam

[![CI](https://github.com/adam-s/goldseam/actions/workflows/ci.yml/badge.svg)](https://github.com/adam-s/goldseam/actions/workflows/ci.yml)

Self-healing for the Cypress suites you already have. When a selector
breaks, the failure becomes a rich capture (redacted DOM + accessibility
tree + error), your model proposes a minimal fix, the suite verifies it,
and the repair lands as a reviewed diff — never a runtime substitution.

Named for kintsugi: the repair is visible, reviewed, and part of the
object's story.

## Install

```bash
npm install --save-dev goldseam
npx goldseam init
```

That's the whole integration. Green runs are untouched; failures write
capture artifacts to `.goldseam/failures/`.

## Heal

```bash
npx goldseam heal          # propose + verify a fix for every capture
git diff                   # review the selector-only edit, then commit
npx goldseam report        # per-test summary of captures and heals
```

Every heal passes a six-rung verification ladder
(`triage → propose → resolve → oracle → rerun-test → rerun-spec`), can
only ever change selector strings, and gives up loudly when a fix would
be a lie. Models: `claude` (default, via the Claude Code CLI) or
`cmd:<executable>` — prompt in on stdin, JSON out.

Full options, artifact schema, and guarantees:
[packages/goldseam/README.md](packages/goldseam/README.md).

## Develop

```bash
git clone https://github.com/adam-s/goldseam && cd goldseam
npm install
npm run build:packages
npm run test:unit && npm run test:system && npm run test:hardening && npm run test:heal
```

- `packages/goldseam/` — the plugin + CLI
- `packages/aria-snapshot/` — Playwright's aria snapshot + targeting
  utilities as a standalone package
  ([npm](https://www.npmjs.com/package/aria-snapshot))
- `demo/` + `cypress/` — the fixture shop and the dogfood suite
- `proving/` — real apps, induced drift, real heals
  ([receipts](proving/CAMPAIGN.md))
- `docs/plan.md` — roadmap; `.agents/reference/` — design references

## License

MIT (`aria-snapshot` is Apache-2.0 with NOTICE).
