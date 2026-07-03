# Contributing

## Layout

Standard Cypress-ecosystem monorepo shape:

- `packages/goldseam/` — the plugin + CLI (published package)
- `packages/aria-snapshot/` — standalone aria-tree serializer (Apache-2.0)
- `demo/` + `cypress/` — the example integration: a fixture shop and a
  dogfood suite that consumes the plugin exactly as a real project would
  (this repo is its own first user)
- `cypress/hardening/`, `cypress/system/` — probe and system-test specs,
  outside the default `specPattern`
- `scripts/` — system-test drivers (Module API), benchmark, stub model
- `bench/` — mutation benchmark definitions + latest results
- `docs/` — build plan and the research knowledge base
- `.agents/` — agent playbooks (see [AGENTS.md](AGENTS.md))

## Build + test

```bash
npm install
npm run build:packages   # required after ANY packages/*/src edit
npm run test:unit        # vitest (~0.5s)
npm run test:system      # capture pipeline against the demo shop
npm run test:hardening   # pinned probe behaviors (retries, cy.origin, …)
npm run test:heal        # full heal loop with the stub model
npm run test:prompt      # cy.goldseam authoring loop with the stub model
```

All five suites run in CI with zero model calls. Real-model runs
(`goldseam heal --model claude`, `scripts/benchmark.mjs`) are local-only.

## Rules that are not style preferences

Read [AGENTS.md](AGENTS.md) — "Hard rules" and "Load-bearing invariants"
define what counts as broken here (never-mask, transparency,
selector-only heals, give-up as a first-class verdict). A PR that
weakens one of those is a regression even if every test stays green;
the mutation-red-team playbook exists to catch exactly that.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`…). Release notes
must name the artifact `schemaVersion` they write — the artifact schema
is a public API (additive → minor, breaking → major).
