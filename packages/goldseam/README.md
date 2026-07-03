# goldseam

Self-healing for the Cypress suites you already have. When a selector
breaks, the failure becomes a rich capture (DOM + accessibility tree +
error); your model — local or API, never a vendor cloud — proposes a
minimal fix; the suite verifies it; the repair arrives as a pull request.

> Status: capture + the Phase-1 heal ladder (`propose → rerun-test →
> rerun-spec`) work end to end. `goldseam pr` / `report` and the oracle
> rung are next — see the [build plan](../../docs/plan.md).

## Install

```bash
npm install --save-dev goldseam
npx goldseam init        # wires both files below for you (idempotent)
```

Or wire it by hand — one line per world:

```ts
// cypress/support/e2e.ts
import 'goldseam/support/register';

// cypress.config.ts
import goldseam from 'goldseam/plugin';
export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      return goldseam(on, config);
    },
  },
});
```

That's the whole integration. Green runs are untouched and write nothing.
When a test fails, a capture artifact appears in `.goldseam/failures/`.
Options? `import { installGoldseam } from 'goldseam/support'` and call it
with an options object instead of the register import — defaults are the
product, options are the escape hatch.

## Options

`installGoldseam(options?)` — browser side:

| Option | Default | Purpose |
| --- | --- | --- |
| `redact` | `true` | Strip form values, mask email/number-like text before anything leaves the page |
| `ariaSnapshot` | `true` | Include the accessibility-tree YAML in captures |
| `maxDomBytes` | `1048576` | DOM size cap; truncated captures carry `domTruncated: true` |

`goldseam(on, config, options?)` — Node side:

| Option | Default | Purpose |
| --- | --- | --- |
| `failuresDir` | `.goldseam/failures` | Where capture artifacts land |

## The capture artifact (schema v1)

```jsonc
// .goldseam/failures/<slug>-<hash6>.json
{
  "schemaVersion": 1,
  "title": "checkout > pays with saved card",
  "specPath": "cypress/e2e/checkout.cy.ts",
  "errorMessage": "Timed out retrying: Expected to find element: `[data-cy=pay]`",
  "url": "https://…",            // "about:blank" ⇒ the visit never loaded (give-up signal)
  "domHtml": "…redacted outerHTML…",
  "ariaSnapshot": "…a11y YAML…", // Playwright format
  "redacted": true,
  "captureError": "…",           // present only if capture degraded
  "domTruncated": true           // present only if domHtml hit maxDomBytes
}
```

This schema is a public API (it is also exactly what the repair model
sees). Additive changes bump the package minor; breaking changes bump the
major.

### Redaction guarantees (default on)

- Values of text-entry form controls (`input` except
  submit/button/reset, `textarea`, `option`) are **never captured**.
- Masked in text nodes, attribute values, the aria snapshot, and the
  capture URL: email-shaped text; long digit runs (7+ digits —
  phone/card/account shaped); JWTs; hex tokens (32+ chars); base64-shaped
  tokens (40+ chars containing digits); and values of sensitive
  query-string parameters (`token`, `key`, `secret`, `session`, `auth`,
  `password`, `code`, `signature`, `api_key`, `access_token`,
  `id_token`, `refresh_token`, `sid`) with keys preserved.
- Redaction is intentionally over-eager: a masked price is cheaper than a
  leaked card number. Selector repair does not need field values.

## Invariants (tested)

- No `cy.*` inside the `fail` handler; when goldseam is the only `fail`
  listener it re-throws in `finally`, so a capture failure can never mask
  — or green-light — a real test failure.
- **Transparent toward your own `Cypress.on('fail')` handlers:** if you
  register one (e.g. to swallow an expected failure), goldseam defers to
  it — your suite behaves exactly as it does without the plugin.
- **Retry-aware:** with test retries enabled, a flaky-then-green test
  leaves no artifact; only the final failed attempt is captured.
- Failures inside `before`/`beforeEach` hooks are captured.
- Captures are best-effort: a degraded capture records `captureError` and
  the run behaves exactly as without the plugin.
- Quiet on green: passing runs produce no artifacts, no logs, no tasks.

## Healing

```bash
npx goldseam heal                 # propose + verify fixes for every capture
npx goldseam heal --dry-run       # propose + validate only; touch nothing
npx goldseam heal --model claude:opus
npx goldseam heal --model "cmd:./my-model.sh"   # any executable: prompt on stdin, JSON reply on stdout
```

The app under test must be reachable (same requirement as `cypress run`).
Each capture runs the ladder — `propose → rerun-test → rerun-spec` — under
a hard attempt cap (default 3, retrying `propose` with feedback). Every
rung's verdict lands in `.goldseam/heals/<capture>-heal.json`; verdicts
are `healed`, `gave-up`, or `failed`, and give-up is a first-class,
reported outcome (page never loaded, degraded capture, low confidence, or
the model's own judgment).

Proposals are validated mechanically before touching disk: exactly one
edit, in the failing spec only, `oldString` unique and verbatim, the
change confined to a quoted selector string, no line-count changes, and
nothing that resembles an assertion edit — heals never weaken assertions.
The model sees the capture and the spec source, never application source.

Model runners: `claude` (the Claude Code CLI in print mode; defaults to
Sonnet), `claude:<model>`, or `cmd:<executable>`. `openai:` / `anthropic:`
/ `ollama:` HTTP runners are planned behind the same interface.

**Heal memory:** every verified model heal records
`broken selector → replacement` in `.goldseam/heal-cache.json`; the next
capture with the same broken selector heals with **zero model calls**
(`tier: "cache"`), and — unlike the incumbents — the cached proposal
still runs the full verification ladder. `--no-cache` opts out.

Single-test isolation in `rerun-test` uses `@cypress/grep` when your
project registers it; without it the whole spec reruns (a superset — a
valid but slower verdict).

## Compatibility

Cypress ≥ 15 (E2E), tested on 15.18. No other plugins required; the task
name is namespaced (`goldseam:capture`) to compose cleanly.

Known walls (documented, not hidden):

- **Shadow DOM** content is not serialized by `outerHTML`, so captures of
  shadow-root-heavy apps are incomplete.
- **`cy.origin`** blocks: the support file cannot reach cross-origin
  documents; captures there degrade to error + URL (`captureError` set).
- If another *plugin* also registers a non-throwing `fail` listener, the
  combination could swallow real failures (each defers to the other).
  goldseam only defers when a second listener exists; audit your support
  file if you install two failure-hooking plugins.

## Troubleshooting

- **Captures not appearing:** restart Cypress after editing
  `cypress.config.ts` (it is loaded once at startup), and confirm
  `goldseam(on, config)` is called in `setupNodeEvents`.
- **Cypress dies instantly in a VS Code terminal:** the integrated
  terminal exports `ELECTRON_RUN_AS_NODE=1`; prefix scripts with
  `env -u ELECTRON_RUN_AS_NODE`.
