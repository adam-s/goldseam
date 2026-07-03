# goldseam

Self-healing for the Cypress suites you already have. When a selector
breaks, the failure becomes a rich capture (DOM + accessibility tree +
error); your model — local or API, never a vendor cloud — proposes a
minimal fix; the suite verifies it; the repair arrives as a pull request.

> Status: capture pipeline. `goldseam heal` / `pr` / `report` are under
> construction — see the [build plan](../../docs/plan.md).

## Install

```bash
npm install --save-dev goldseam
```

```ts
// cypress/support/e2e.ts
import { installGoldseam } from 'goldseam/support';
installGoldseam();

// cypress.config.ts
import { goldseam } from 'goldseam/plugin';
export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      goldseam(on, config);
      return config;
    },
  },
});
```

That's the whole integration. Green runs are untouched and write nothing.
When a test fails, a capture artifact appears in `.goldseam/failures/`.

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
- Email-shaped text and long digit runs (7+ digits, or 12+ with
  space/dash separators — phone/card/account shaped) are masked in text
  nodes, attribute values, and the aria snapshot.
- Redaction is intentionally over-eager: a masked price is cheaper than a
  leaked card number. Selector repair does not need field values.

## Invariants (tested)

- No `cy.*` inside the `fail` handler; the handler re-throws in `finally`,
  so a capture failure can never mask — or green-light — a real test
  failure.
- Captures are best-effort: a degraded capture records `captureError` and
  the run behaves exactly as without the plugin.
- Quiet on green: passing runs produce no artifacts, no logs, no tasks.

## Compatibility

Cypress ≥ 15 (E2E), tested on 15.18. No other plugins required; the task
name is namespaced (`goldseam:capture`) to compose cleanly.

## Troubleshooting

- **Captures not appearing:** restart Cypress after editing
  `cypress.config.ts` (it is loaded once at startup), and confirm
  `goldseam(on, config)` is called in `setupNodeEvents`.
- **Cypress dies instantly in a VS Code terminal:** the integrated
  terminal exports `ELECTRON_RUN_AS_NODE=1`; prefix scripts with
  `env -u ELECTRON_RUN_AS_NODE`.
