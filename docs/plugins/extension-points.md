# Cypress extension points — the complete catalog

Two worlds, two catalogs. Everything a plugin can legally touch is below;
anything not listed rides internals and can break on any minor release.

## Browser world (support file)

Loaded before every spec, runs in the spec frame beside the AUT. Reached by
`import 'your-plugin/support'` in the user's `cypress/support/e2e.ts`.

### Events (`Cypress.on` / `cy.on`)

| Event | Fires when | qa-relocator relevance |
|---|---|---|
| `fail` | A command/assertion fails, before the test is marked failed | **Our capture hook.** Handler must re-throw or the failure is swallowed (test goes green) |
| `test:before:run` / `test:after:run` | Around each test | Alternative reset point for per-test state |
| `window:before:load` | AUT window created, before app code runs | Injecting instrumentation into the app |
| `uncaught:exception` | App throws uncaught error | Return `false` to suppress test failure — same swallow risk as `fail` |
| `command:start` / `command:end` / `command:retry` | Command lifecycle | Selector telemetry (which selectors run, how often they retry) |
| `log:added` / `log:changed` | Command-log entries | How reporter-ish plugins mirror the command log |
| `viewport:changed`, `url:changed`, `scrolled` | Page state changes | Context enrichment |

`Cypress.on` persists across tests in a spec; `cy.on` is per-test.
**Citizenship rule:** browser events are multi-listener — your handler runs
alongside the user's. Never `stopPropagation`-style suppress, never swallow
errors, keep handlers synchronous and fast.

### Custom commands

- `Cypress.Commands.add('name', fn)` — new command (`@testing-library/cypress`
  adds `findByRole` etc. this way).
- `Cypress.Commands.overwrite('get', fn)` — wrap built-ins. Powerful and
  dangerous: two plugins overwriting the same command compose in undefined
  order. qa-relocator idea (see blueprint): an *opt-in* `cy.get` overwrite
  that records selector→element mappings for oracle checks, default off.
- `Cypress.Commands.addQuery('name', fn)` (Cypress 12+) — retry-able queries;
  required if the command participates in built-in retryability.

### Bridges out of the browser

- `cy.task(name, payload)` — the RPC to `setupNodeEvents`. Serializable
  payloads only; the only sanctioned browser→Node channel. **Our capture ship.**
- `Cypress.automation('remote:debugger:protocol', {command, params})` — a
  semi-public borrow of the server's CDP session. Chromium-only. Precedent at
  scale: `cypress-real-events` (1.24M dl/wk) is built entirely on it.
- `Cypress.backendRequest(...)` — internal; do not build on it.

### Ambient APIs

`Cypress.env()` (config-injected options), `Cypress.spec`, `Cypress.currentTest`,
`Cypress.$` (jQuery bound to the AUT document — our AUT-document access in the
fail handler), `Cypress.config()`.

## Node world (`setupNodeEvents(on, config)`)

Runs in the Cypress server's plugin child process. Full Node: fs, network,
child processes. Reached by the user calling your exported function.

### `on(...)` registrations

| Registration | Fires | Notes |
|---|---|---|
| `on('task', {...})` | `cy.task` calls | Merged by task name across calls; same-name later registration wins. Must return a value or promise (`null` ok) |
| `on('before:run')` / `on('after:run')` | Once per `cypress run` | Run-level artifact setup/teardown |
| `on('before:spec')` / `on('after:spec')` | Around each spec file | **Single-listener: a second registration silently replaces the first.** This is why `cypress-on-fix` exists (147K dl/wk). Design to not need these, or document the conflict |
| `on('before:browser:launch')` | Browser starting | Flags, extensions, CDP port. Single-listener caveat applies |
| `on('after:screenshot')` | Screenshot written | Rename/move/annotate artifacts |
| `on('file:preprocessor')` | Spec bundling | Whole-hog replacement (esbuild/vite preprocessors live here). Exclusive — only one wins |
| `on('dev-server:start')` | Component testing | Not relevant to us (E2E) |

`config` mutation: return a (modified) config object to change resolved
config — how `cypress-split` filters `specPattern` and `@cypress/grep`
injects env. Keep mutations additive and idempotent.

## Outside the run entirely

- **Module API**: `const cypress = require('cypress'); await cypress.run({...})`
  — programmatic runs with full result objects. **Our M5 verification loop.**
  Also `cypress.cli.parseRunArguments` for CLI wrappers.
- **Reporters**: Mocha reporter interface (`cypress-mochawesome-reporter`).
  We don't need one — our output is PRs, not HTML.
- **A separate CLI over artifact files** — not a Cypress API at all, but the
  paradigm `allure-cypress` proves: the plugin writes files during the run; a
  CLI consumes them after. No Cypress coupling in the second stage.

## What is NOT extensible (and matters)

- **`cy.prompt`'s delivery channel.** Module Federation injection of
  cloud-delivered bundles (see [cy-prompt-anatomy.md](cy-prompt-anatomy.md))
  is Cypress-private. Third parties cannot register remote modules. Fine for
  us: our architecture needs no runtime code delivery.
- **The `/__cypress/*` proxy namespace** — internal routing, no plugin hooks.
- **Cross-origin iframe access** — browser security, not a plugin gap.
  `cy.origin` covers top-level navigation only. Both cy.prompt and we
  declare iframes out of scope; it's a wall, not a corner cut.
- **Firefox/WebKit CDP** — `Cypress.automation('remote:debugger:protocol')`
  is Chromium-only, and v15's protocol shuffles (Firefox → WebDriver BiDi)
  show that ground moves. Anything protocol-adjacent should be optional
  enrichment, never the core path (our aria-snapshot choice already
  encodes this).
