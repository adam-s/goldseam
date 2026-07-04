# goldseam

**goldseam is an open, bring-your-own-model alternative to Cypress's
`cy.prompt()`.** `cy.prompt()` is Cypress's experimental, Cypress Cloud–hosted
command that writes test steps from plain English and self-heals them; it
needs a Cloud login or record key, and its model and cache live in Cypress's
cloud.

goldseam does the same two jobs — write test steps in plain English, and heal
selectors that break — except the model is yours and nothing runs in a vendor
cloud. By default it drives the Claude Code CLI you already have
(`claude -p`), so there's no API key to wire; or point it at a local Ollama,
any OpenAI-compatible endpoint, or any command-line program.

Every result lands as a committed, reviewable file instead of magic that
happens behind your back.

goldseam is **two separate tools**, on purpose:

1. **Heal** — an existing `cy.get(...)` selector broke; your model proposes
   a minimal fix and the suite proves it before it lands.
2. **Author** — you want a new test; write the steps in English and
   `cy.goldseam([...])` translates them once into real Cypress commands.

## Why heal and author stay separate

`cy.prompt()` markets one loop: write a step in plain language, and when the
UI shifts it self-heals. We deliberately did **not** copy that — heal and
author never touch. Here's why.

When a plain-English step breaks, you can't tell *which* thing went wrong,
and the candidates are not the same kind of problem:

- the **app under test** actually regressed (the step *should* fail), or
- the **sentence was too vague** to pin one element in the first place, or
- a re-resolve would land on a **plausible but semantically wrong** element
  — a look-alike that passes every assertion while testing the wrong thing.

Merged, those uncertainties **compound into a confident false green** — the
worst outcome a test tool can produce, because the suite now lies while
looking healthy. Avoiding it means the model has to guess your intent
correctly — safely, every time, unattended — and we doubt a hosted inference
model clears that bar.

So we keep them as two sharp tools. You iterate accurately and fast because
the failure modes stay *separable*: a bad translation means the model
misread your sentence (fix the sentence); a bad heal means it picked the
wrong element (reject the diff) — never both tangled into one green check
you can't trust. The full reasoning is in
[authored-self-healing.md](https://github.com/adam-s/goldseam/blob/main/.agents/reference/authored-self-healing.md).

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

---

## Tool 1 — Heal a test that broke

**Use this when:** you have hand-written Cypress tests and a selector
stopped matching (someone renamed a `data-testid`, swapped a class,
restructured the DOM).

![a broken selector healed into a reviewed one-line diff](https://raw.githubusercontent.com/adam-s/goldseam/main/docs/media/demo.gif)

### How you use it

1. **Run your tests like normal.** When one fails, goldseam quietly saves a
   snapshot of the broken page to `.goldseam/failures/` — the DOM, the
   accessibility tree, and the error. A passing run saves nothing.
2. **Point your model at the failures:**
   ```bash
   npx goldseam heal
   ```
3. goldseam proposes the **smallest possible selector fix**, re-runs the
   test to prove the fix actually passes, and leaves the change **in your
   working tree** for you to read and commit. Nothing is ever substituted
   at runtime, and nothing lands unreviewed.

```bash
npx goldseam heal                 # propose + verify a fix for every capture
npx goldseam heal --dry-run       # propose + validate only; touch nothing
npx goldseam heal --model claude:opus
npx goldseam heal --model "cmd:./my-model.sh"   # any executable: prompt on stdin, reply on stdout
npx goldseam report               # per-test summary of captures + heals (--format json)
```

The app under test must be reachable (same requirement as `cypress run`).

Captures outlive their heal: a successful heal edits your spec but leaves
the capture in `.goldseam/failures/` — a later failing run refreshes it;
delete the file once the heal is committed. Re-running `heal` on a stale
capture is cheap: goldseam detects that the broken selector is gone from
the spec and reports it without a model call.

### What it actually does

Each capture runs a six-rung **ladder** — `triage → propose → resolve →
oracle → rerun-test → rerun-spec` — under a hard attempt cap (default 3).
Every rung's verdict is written to `.goldseam/heals/<capture>-heal.json`;
the outcome is `healed`, `gave-up`, or `failed`. **Give-up is a first-class
result**, not a hidden failure (the page never loaded, the capture was
degraded, confidence was low, or the model judged it unfixable).

Three rungs judge **offline**, against the captured page, before spending a
single test re-run:

- **`triage`** (before the model): if the "missing" selector still matches
  the snapshot, the element appeared too late or is state-gated — a
  timing problem no selector edit can fix. Give-up, zero model calls.
- **`resolve`** (after the model proposes): the healed selector must
  resolve in the DOM the model saw — zero matches (a hallucination) or too
  many matches (ambiguity) reject the proposal with feedback before an
  expensive re-run.
- **`oracle`** (identity, not just existence): turn on `recordOracles:
  true` and every **passing** test records its selectors' accessibility
  identities to `.goldseam/oracle.json`. When the app later drifts, the fix
  must land on the same identity the selector had while green — so a
  look-alike element that would pass every assertion is rejected offline.

Two safety nets you should know about:

- **Verified is not the same as correct.** A re-run proves the test
  *passes*, not that the selector points at the intended element. A heal
  whose test only asserts existence/visibility is tagged
  `reviewFlags: ["weak-assertions…"]` and flagged in the CLI so you review
  it — flags route attention, they never block.
- **Heals can never weaken assertions.** Before touching disk, every
  proposal is validated mechanically: exact-string edits in the failing
  spec only, each confined to a quoted selector string, no line-count
  changes, nothing that resembles an assertion edit. The model sees the
  captured page and the failing spec — **never your application source.**

**Heal memory:** every verified fix records `broken selector → replacement`
in `.goldseam/heal-cache.json`; the next identical break heals with **zero
model calls** (`tier: "cache"`) — and, unlike the incumbents, still runs
the full verification ladder. `--no-cache` opts out.

**Your model — pick the runner with `--model`:**

- **`claude`** *(default)* — the Claude Code CLI in print mode
  (`claude -p`). If you already use Claude Code, there's nothing else to
  set up. Defaults to Sonnet; use `claude:opus` etc. to choose. *(Also the
  default for Tool 2's translation.)*
- **`ollama:<model>`** — a local model over Ollama's HTTP API, **zero
  egress** (the air-gapped story). Proven end-to-end: a local 14B Qwen
  healed a broken `id` selector through the full ladder — one scenario with
  a real local model, not yet a heal-rate-across-selector-styles table.
- **`openai:<model>`** — **any OpenAI-compatible chat endpoint** via
  `OPENAI_BASE_URL` + `OPENAI_API_KEY`: OpenAI itself, or a self-hosted
  vLLM / LM Studio / GPU box. The runner is **proven against real OpenAI**
  (`gpt-4o-mini`: request → response → JSON-block parse, 2026-07-04) — it's
  not exercised in CI, which makes no cloud calls. To **self-host** the
  model on your own GPU, there's a copy-paste Modal recipe — deploy a
  private endpoint in a few commands:
  [`selfhost/modal/README.md`](https://github.com/adam-s/goldseam/blob/main/selfhost/modal/README.md).
- **`cmd:<executable>`** — the universal escape hatch: any program that
  reads the prompt on stdin and writes the reply on stdout. This is where
  you wrap an SDK goldseam doesn't call directly (e.g. a short script using
  the Vercel AI SDK or AWS Bedrock).

Simple id/class selectors heal reliably on a 14B local model; if a smaller
model mangles a long attribute selector, the validator rejects the garbage
and the heal fails honestly rather than applying it.

---

## Tool 2 — Write a test in plain English

**Use this when:** you want a new test and would rather describe it than
hand-write every selector.

![plain-English steps translated, cached, replayed, and ejected](https://raw.githubusercontent.com/adam-s/goldseam/main/docs/media/authored.gif)

### How you use it

Visit the page first, then write the steps as plain sentences:

```ts
cy.visit('/shop');
cy.goldseam([
  'Add the Ember Mug to the cart',
  'Type {{customer}} into the full name field',
  'The cart count should show 1',
], { placeholders: { customer: Cypress.env('NAME') } });
```

- The **first run** sends your steps + the current page to your model,
  which turns them into a fixed list of real Cypress commands and saves it
  to `.goldseam-prompts/`.
- **Every run after that** replays that saved file — no model call, no
  cost, and you can read exactly what it will do in code review.

The `cy.visit(...)` before the call matters: the first-run translation
reads the **loaded page** to ground its selectors. Steps that describe
elements on a page that hasn't been visited yet translate against a blank
page and are refused.

### What it actually does

- Steps translate ONCE into a **fixed command vocabulary** —
  visit/click/dblclick/type/check/uncheck/select/trigger/scrollTo/viewport/assert/wait.
  Generated code is never `eval`'d; `trigger` means hover/tooltip flows
  work.
- Translations cache as **files in `.goldseam-prompts/` — committable**, so
  the cache is code-reviewed, shared through git, and replays in CI with
  zero model calls. (The incumbent's cache lives in *their* cloud.)
- `{{placeholder}}` values are filled in at execution time only — they
  never reach the model and never change the cache identity.
- A vague step **fails loud** rather than guessing at the wrong element,
  and that refusal is cached so it stays deterministic.
- 50-step cap per call.
- `npx goldseam eject` renders any cached translation as plain Cypress
  code — and unlike the incumbent, **ejected code still heals**: it goes
  through the normal capture → heal pipeline (Tool 1).
- If the app changes under an authored test, the cached translation is
  what breaks — and healing edits spec code, not caches. Delete that
  cache file (or edit the steps) to retranslate against the new page, or
  eject first and let the pasted code heal like any other spec.
- Translation model: the plugin's `promptModel` option (default `claude` →
  Sonnet), or the `GOLDSEAM_PROMPT_MODEL` env var.

---

## Reference

### Options

`installGoldseam(options?)` — browser side (use instead of the `register`
import when you want to change a default):

| Option | Default | Purpose |
| --- | --- | --- |
| `redact` | `true` | Strip form values, mask email/number-like text before anything leaves the page |
| `ariaSnapshot` | `true` | Include the accessibility-tree YAML in captures |
| `maxDomBytes` | `1048576` | DOM size cap; truncated captures carry `domTruncated: true` |
| `recordOracles` | `false` | Record passing tests' selector identities to `.goldseam/oracle.json` (feeds the oracle rung) |

`goldseam(on, config, options?)` — Node side:

| Option | Default | Purpose |
| --- | --- | --- |
| `failuresDir` | `.goldseam/failures` | Where capture artifacts land |
| `promptModel` | `claude` | Model that translates `cy.goldseam()` steps |

### Configuration file — `goldseam.config.mjs`

Both tools pick their model in different places by default (the `--model`
flag for heal, the `promptModel` option for authoring). To set it **once**
for both, drop a `goldseam.config.mjs` at your project root — read by the
CLI *and* the plugin:

```js
// goldseam.config.mjs
export default {
  model: 'ollama:qwen2.5:14b',        // both tools, unless overridden
  // healModel: 'claude:opus',         // per-tool override (optional)
  // promptModel: 'ollama:qwen2.5:14b',
  // heal: { maxAttempts: 3, minConfidence: 0.5, cache: true },
  // author: { promptsDir: '.goldseam-prompts' },
};
```

Everything is a default. **Precedence, most specific wins:** CLI flag /
plugin option **>** env var (`GOLDSEAM_MODEL`, `GOLDSEAM_PROMPT_MODEL`)
**>** `goldseam.config.mjs` **>** built-in default — so
`goldseam heal --model claude:opus` still wins for a one-off run. **Secrets
stay in env** (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OLLAMA_HOST`); the
config file holds only the model spec and non-secret defaults. `.mjs` (not
`.ts`) so the standalone CLI loads it with no bundler and no ambiguity
about ESM vs CommonJS. A copy-ready template with every field lives at
[`goldseam.config.example.mjs`](https://github.com/adam-s/goldseam/blob/main/goldseam.config.example.mjs).

### The capture artifact (schema v1)

```jsonc
// .goldseam/failures/<slug>-<hash6>.json
{
  "schemaVersion": 1,
  "title": "checkout > pays with saved card",
  "specPath": "cypress/e2e/checkout.cy.ts",
  "errorMessage": "Timed out retrying: Expected to find element: `[data-cy=pay]`",
  "failedSelector": "[data-cy=pay]", // parsed from the error when derivable
  "url": "https://…",            // "about:blank" ⇒ the visit never loaded (give-up signal)
  "domHtml": "…redacted outerHTML…",
  "ariaSnapshot": "…a11y YAML…", // Playwright format
  "redacted": true,
  "captureError": "…",           // present only if capture degraded
  "domTruncated": true           // present only if domHtml hit maxDomBytes
}
```

This schema is a public API (it is also exactly what the model sees).
Additive changes bump the package minor; breaking changes bump the major.

#### Redaction guarantees (default on)

- Values of text-entry form controls (`input` except submit/button/reset,
  `textarea`, `option`) are **never captured**.
- Masked in text nodes, attribute values, the aria snapshot, and the URL:
  email-shaped text; long digit runs (7+ digits); JWTs; hex tokens (32+
  chars); base64-shaped tokens; and values of sensitive query-string
  params (`token`, `key`, `secret`, `session`, `auth`, `password`, `code`,
  `signature`, `api_key`, `access_token`, `id_token`, `refresh_token`,
  `sid`) with keys preserved.
- Redaction is intentionally over-eager: a masked price is cheaper than a
  leaked card number. Selector repair does not need field values.

### Invariants (tested)

- No `cy.*` inside the `fail` handler; when goldseam is the only `fail`
  listener it re-throws in `finally`, so a capture failure can never mask —
  or green-light — a real test failure.
- **Transparent toward your own `Cypress.on('fail')` handlers:** if you
  register one (e.g. to swallow an expected failure), goldseam defers to
  it — your suite behaves exactly as it does without the plugin.
- **Retry-aware:** with test retries enabled, a flaky-then-green test
  leaves no artifact; only the final failed attempt is captured.
- Failures inside `before`/`beforeEach` hooks are captured.
- Captures are best-effort: a degraded capture records `captureError` and
  the run behaves exactly as without the plugin.
- Quiet on green: passing runs produce no artifacts, no logs, no tasks
  (the opt-in oracle manifest is the one sanctioned exception).

### Compatibility

Cypress ≥ 15 (E2E), tested on 15.18. No other plugins required; the task
name is namespaced (`goldseam:capture`) to compose cleanly. Single-test
isolation in `rerun-test` uses `@cypress/grep` when your project registers
it; without it the whole spec reruns (a valid but slower verdict).

Known walls (documented, not hidden):

- **Open shadow roots are captured** (as declarative
  `<template shadowrootmode="open">` markup); **closed shadow roots** are
  unreachable by design.
- **Same-origin iframe documents are captured** (inlined as
  `<template data-frame-content>` markup); **cross-origin frames** stay
  opaque, honestly.
- **`cy.origin`** blocks: the support file cannot reach cross-origin
  documents; captures there degrade to error + URL (`captureError` set).
- If another *plugin* also registers a non-throwing `fail` listener, the
  combination could swallow real failures (each defers to the other).
  Audit your support file if you install two failure-hooking plugins.

### Troubleshooting

- **Captures not appearing:** restart Cypress after editing
  `cypress.config.ts` (it is loaded once at startup), and confirm
  `goldseam(on, config)` is called in `setupNodeEvents`.
- **Cypress dies instantly in a VS Code terminal:** the integrated terminal
  exports `ELECTRON_RUN_AS_NODE=1`; prefix scripts with
  `env -u ELECTRON_RUN_AS_NODE`.
- **`allowCypressEnv` deprecation warnings during heal:** Cypress 15 prints
  this on every Module-API run the rerun rungs make — upstream and
  cosmetic, not a goldseam error.

> `goldseam pr` (heal delivered as a ready-made pull request) is planned.
> The reasoning behind keeping heal and author separate lives in
> [authored-self-healing.md](https://github.com/adam-s/goldseam/blob/main/.agents/reference/authored-self-healing.md).
