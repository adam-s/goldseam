# Plugin paradigms — taxonomy and case studies

Field data collected 2026-07-03 (npm registry). Every plugin below is
actively maintained; download counts are weekly.

| Plugin | DLs/wk | Last publish | Paradigm |
|---|---|---|---|
| `@testing-library/cypress` | 1.35M | 2026-04 | Support-only commands |
| `cypress-real-events` | 1.24M | 2025-09 | Support-only over CDP |
| `cypress-axe` | 690K | 2025-08 | Command + task pair |
| `@cypress/grep` | 653K | 2026-06 | Dual entry |
| `cypress-terminal-report` | 620K | 2025-10 | Collector → bridge → writer |
| `cypress-mochawesome-reporter` | 418K | 2025-08 | Reporter, zero-config |
| `cypress-split` | 360K | 2026-06 | Node-only config mutation |
| `cypress-on-fix` | 147K | 2025-01 | Composition shim (a warning) |
| `allure-cypress` | 62K | 2026-06 | Artifacts + external CLI |

## Paradigm 1 — Support-only

One import adds commands or behavior; no Node side at all.

```ts
// user's support file — the entire install
import '@testing-library/cypress/add-commands'
```

- **Example:** `@testing-library/cypress` (adds `findByRole` etc.),
  `cypress-real-events` (adds `cy.realClick` etc., implemented as
  `Cypress.automation` CDP calls).
- **When:** everything you need is reachable from the browser world.
- **Limit:** no filesystem, no network you control, no persistence.

## Paradigm 2 — Node-only

A function called in `setupNodeEvents`; no support import.

```ts
// cypress.config.ts — the entire install
import cypressSplit from 'cypress-split'
setupNodeEvents(on, config) {
  cypressSplit(on, config)
  return config
}
```

- **Example:** `cypress-split` (mutates `specPattern` for CI sharding).
- **When:** the work is about the run, not the page.

## Paradigm 3 — Dual entry (the standard for anything substantial)

Two entry points, one package. The user wires both; each side gets an
options object.

```ts
// support:
import { installLogsCollector } from 'cypress-terminal-report/src/installLogsCollector'
installLogsCollector({ collectTypes: ['cy:log', 'cons:error'] })

// config:
import { installLogsPrinter } from 'cypress-terminal-report/src/installLogsPrinter'
setupNodeEvents(on, config) {
  installLogsPrinter(on, { printLogsToFile: 'always' })
  return config
}
```

- **Examples:** `cypress-terminal-report`, `@cypress/grep`, `cypress-axe`
  (command + `task` for the axe run), `allure-cypress`.
- **Why it wins:** each side does only what its world allows; the `cy.task`
  bridge is the contract between them.

## Paradigm 4 — Collector → bridge → writer (dual entry, specialized)

`cypress-terminal-report`'s refinement of paradigm 3, and **qa-relocator's
browser-side shape**: browser-side hooks *collect* context into memory,
batch it, ship via `cy.task` at a safe lifecycle point, Node side *writes*.

Design rules it demonstrates, all of which our M1 code independently
converged on (a good sign the rules are real):

1. Collect synchronously in event handlers; never enqueue commands there.
2. Ship at hook boundaries (`afterEach`), not inside the event that
   collected — the event may fire mid-machinery.
3. The Node side owns naming, directories, and durability.
4. Collection must be crash-proof: a collector bug must never alter test
   outcomes (our stash + `finally { throw err }`).

## Paradigm 5 — Artifacts + external CLI (the product paradigm)

The plugin's only job during the run is writing **standardized artifact
files**. A separate CLI — no Cypress dependency — consumes them afterward.

```
cypress run          →  .allure-results/*.json     (plugin, during run)
allure generate      →  HTML report                (CLI, after run)
```

- **Example:** `allure-cypress` + Allure CLI (Qameta; the artifact schema is
  versioned and language-agnostic — Playwright/Java/Python adapters write
  the same format).
- **qa-relocator mapping:**

```
cypress run          →  .qa-relocator/failures/*.json   (plugin, during run)
qa-relocator heal    →  verified selector fixes          (CLI + LLM, after run)
qa-relocator pr      →  reviewed pull request            (CLI + git, after run)
```

- **Why this is our paradigm:** the LLM lives entirely in the CLI stage.
  Test runs never block on model calls, never need API keys in CI secrets
  for the run itself, and the self-hosted story is clean: point the CLI at
  any model, including a local one. It also makes the plugin trivially
  auditable — it only ever *writes files*.

## Composition & citizenship (the cypress-on-fix lesson)

147K downloads/week for a shim that exists because `setupNodeEvents` events
like `after:spec` are **single-listener** — the last plugin to register
silently wins. Rules for not being the plugin that breaks the other plugin:

- Prefer `on('task')` (merges by name) over lifecycle events. Namespace task
  names (`qa-relocator:capture`, not `capture`).
- If a lifecycle event is unavoidable, accept a pre-wrapped `on` (works
  under `cypress-on-fix`) and say so in the README.
- Browser side: never suppress events or errors others rely on; `fail`
  handlers re-throw, always.
- Test compatibility explicitly against the top five plugins (a CI job with
  all of them installed is cheap and almost nobody does it — visible
  professionalism).
- Zero-config default (`cypress-mochawesome-reporter`'s adoption lesson):
  `install()` with no arguments must do something sensible.

## Idea ledger (ours, from studying the field)

- **Selector telemetry mode:** `command:start/retry` listeners could record
  per-selector retry counts across the suite — "your 10 flakiest selectors"
  as a free byproduct, and a prioritization signal for pre-emptive healing.
- **Heal-tier reporting à la cy.prompt:** captures and heals carry a tier
  label (`healed-via-cache` when a previously-verified fix is reapplied on a
  new branch vs `healed-via-model`) — same vocabulary as the incumbent,
  easing evaluation against it.
- **`cypress-on-fix` bundling:** depend on it (or vendor the pattern) so our
  README can say "plays nice with your existing plugins, verified."
