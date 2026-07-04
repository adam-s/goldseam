# goldseam

Self-healing for the Cypress suites you already have. When a selector
breaks, the failure becomes a rich capture (DOM + accessibility tree +
error); your model — local or API, never a vendor cloud — proposes a
minimal fix; the suite verifies it through a six-rung ladder; the repair
lands as a reviewed diff in your working tree — never a runtime
substitution.

> `goldseam pr` (heal delivered as a ready-made pull request) is the next
> milestone — the
> [roadmap](https://github.com/adam-s/goldseam/blob/main/docs/plan.md)
> has the rest.

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
Each capture runs the ladder — `triage → propose → resolve → oracle →
rerun-test → rerun-spec` — under a hard attempt cap (default 3, retrying
`propose` with feedback). Every rung's verdict lands in
`.goldseam/heals/<capture>-heal.json`; verdicts are `healed`, `gave-up`,
or `failed`, and give-up is a first-class, reported outcome (page never
loaded, degraded capture, low confidence, or the model's own judgment).

Three rungs judge offline, against the captured DOM, before any rerun:

- **`triage`** (pre-model): if the "missing" selector still matches the
  capture, the element appeared after Cypress stopped retrying or is
  state-gated — a timing problem no selector edit can fix. Give-up, zero
  model calls.
- **`resolve`** (post-propose): the healed selector must resolve in the
  DOM the model saw — zero matches (a hallucination) or several matches
  where the call chain expects one element (ambiguity) reject the
  proposal with feedback before an expensive rerun. Selectors static
  analysis can't evaluate are deferred to the rerun rungs, with evidence.
- **`oracle`** (post-resolve): identity, not just existence. Turn on
  `recordOracles: true` (support options or Cypress env `goldseam`) and
  every PASSING test records its selectors' aria identities into
  `.goldseam/oracle.json` — the one sanctioned exception to "green runs
  write nothing", and it writes only that manifest. When the app later
  drifts, the heal for a broken selector must land on the identity that
  selector had while green. Entries can also be hand-written —
  `[{ "specPath": "…", "title": "…", "role": "button", "name": "Add to cart" }]`
  — the healed selector must land on an element matching it. A look-alike
  that would pass every assertion is rejected offline (the impostor
  guard); an identity that no longer exists in the capture is an honest
  give-up. No entry on file means a skip, with evidence, never a silent
  verdict.

Verified is not the same as correct: a rerun proves the healed test
*passes*, not that the selector points at the intended element. A heal
whose enclosing test asserts only existence/visibility carries
`reviewFlags: ["weak-assertions…"]` in its artifact, a ⚠ in the CLI, and
a Flags column in `goldseam report` — flags route review, they never
block. The full catalog of these judgment calls and their guards:
[the disambiguation catalog](https://github.com/adam-s/goldseam/blob/main/.agents/reference/disambiguation.md).

Proposals are validated mechanically before touching disk: exact-string
edits in the failing spec only (one per occurrence of the broken
selector, capped at 8), each `oldString` unique and verbatim, every
change confined to a quoted selector string, no line-count changes, and
nothing that resembles an assertion edit — heals never weaken assertions.
The model sees the capture and the spec source, never application source.

Model runners: `claude` (the Claude Code CLI in print mode; defaults to
Sonnet), `claude:<model>`, `ollama:<model>` (local HTTP, zero egress —
the air-gapped story; host via `OLLAMA_HOST`, JSON-constrained decoding
on), `openai:<model>` (any OpenAI-compatible endpoint — OpenAI proper, a
Modal/vLLM `serve` deployment, LM Studio — via `OPENAI_BASE_URL` +
`OPENAI_API_KEY`), or `cmd:<executable>` (prompt on stdin, reply on
stdout). Local-model guidance: id/class-culture selectors heal reliably
on a 14B Qwen; long attribute-quoted selectors can defeat smaller
models' JSON escaping — the validator rejects the mangled edit and the
heal fails honestly rather than applying garbage.

**Heal memory:** every verified model heal records
`broken selector → replacement` in `.goldseam/heal-cache.json`; the next
capture with the same broken selector heals with **zero model calls**
(`tier: "cache"`), and — unlike the incumbents — the cached proposal
still runs the full verification ladder. `--no-cache` opts out.

Single-test isolation in `rerun-test` uses `@cypress/grep` when your
project registers it; without it the whole spec reruns (a superset — a
valid but slower verdict).

## Natural-language authoring — `cy.goldseam()`

The cy.prompt-shaped API, minus the vendor cloud:

```ts
cy.goldseam([
  'Go to the shop',
  'Add the Ember Mug to the cart',
  'Type {{customer}} into the full name field',
  'The cart count should show 1',
], { placeholders: { customer: Cypress.env('NAME') } });
```

- Steps translate ONCE (through your model) into a **constrained command
  vocabulary** — visit/click/type/check/select/trigger/scrollTo/
  viewport/assert/wait. Generated code is never evaluated; `trigger`
  means hover/mouseenter tooltips work (cypress#33042's top ask).
- Translations cache in **`.goldseam-prompts/` — a committable file**,
  so the cache is code-reviewed, shared through git, and replays in CI
  with zero model calls. (The incumbent's cache lives in their Cloud;
  file-based caching is their users' top wish, cypress#33273.)
- `{{placeholder}}` values substitute at execution time only — they
  never reach the model and never affect cache identity (parity).
- 50-step cap per call (parity). Call it after the page under test has
  loaded, or the first-run translation sees a blank page.
- `npx goldseam eject` renders any cached translation as plain Cypress
  code — and unlike the incumbent, **ejecting keeps healing**: pasted
  code goes through the normal capture → heal pipeline.
- Translation model: the plugin's `promptModel` option (default
  `claude` → Sonnet), or the `GOLDSEAM_PROMPT_MODEL` env var.

## Compatibility

Cypress ≥ 15 (E2E), tested on 15.18. No other plugins required; the task
name is namespaced (`goldseam:capture`) to compose cleanly.

Known walls (documented, not hidden):

- **Open shadow roots are captured** (as declarative
  `<template shadowrootmode="open">` markup, redacted like everything
  else); **closed shadow roots** are unreachable by design.
- **Same-origin iframe documents are captured** — inlined as sibling
  `<template data-frame-content>` markup (redacted like everything else)
  with the frame content nested under its `iframe` node in the aria
  snapshot; **cross-origin frames** stay opaque, honestly.
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
