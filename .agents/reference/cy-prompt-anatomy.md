# cy.prompt anatomy — how the incumbent actually works

First-party evidence gathered 2026-07-03 from the Cypress 15.18.0 binary
installed at `~/Library/Caches/Cypress/15.18.0/`, plus official docs. This
is the competitive reference for goldseam's design.

## The headline: cy.prompt is not in the open-source product

The `cy.prompt` command in the OSS driver is a **loader stub**. From the
shipped driver bundle (`packages/runner/dist/cypress_runner.js`, ~offset
5.83M, readable webpack output):

```js
init({
  remotes: [{
    alias: 'cy-prompt',
    type: 'module',
    name: 'cy-prompt',
    entryGlobalName: 'cy-prompt',
    entry: '/__cypress-cy-prompt/driver/cy-prompt.js',
    shareScope: 'default'
  }],
  name: 'driver'
})
// "This cy-prompt.js file and any subsequent files are
//  served from the cy prompt bundle."
module = await loadRemote('cy-prompt')
```

- The implementation is loaded at runtime via **webpack Module Federation**
  from a bundle the server downloads from Cypress Cloud (there is a
  "bundle download timed out" error path, and a
  `prompt.promptBundleNeedsRefresh` error).
- The stub hands everything to the downloaded module:
  `cyPrompt({ steps, commandOptions, promptCmd })`.
- The type stubs shipped in the app say it outright
  (`packages/types/esm/cy-prompt/cy-prompt-server-types.js`):
  *"This file is owned by the cloud delivered cy-prompt bundle. It is
  downloaded and copied to the app."*
- Lifecycle statuses: `NOT_INITIALIZED → INITIALIZING → INITIALIZED → IN_ERROR`.

**Implications:**

1. There is no self-hosted mode because there is nothing to self-host — the
   feature is proprietary code injected into the OSS app at runtime, gated
   on Cloud auth.
2. Nobody can fork or extend it; the Module Federation channel is not a
   third-party extension point.
3. Any open alternative must be built from public extension points — which
   is exactly what goldseam does.

## Documented behavior (docs + blog + changelog + issue queue, July 2026)

- **Input:** `cy.prompt(steps: string[], options?: { placeholders? })` —
  English steps; `placeholders` is the **only** options-object key.
  `{{placeholder}}` values are excluded from AI calls and from cache
  identity. `timeout`/`force` are expressed *inside* the natural-language
  step ("with a timeout of 10 seconds", "force click"), not as options.
  Yields whatever the final generated command yields.
- **Translation:** Cloud-hosted LLMs convert steps to Cypress commands using
  page context; sensitive DOM data (passwords, credit cards, hidden inputs)
  auto-excluded.
- **Caching:** generated code cached after first run; the cache lives **in
  Cypress Cloud** (no file-based representation — confirmed by maintainer
  in [#33273](https://github.com/cypress-io/cypress/issues/33273)), shared
  across machines/CI; repeat runs make no AI calls; cache keyed on the
  whole step array — adding one step invalidates the entire prompt's cache.
- **Self-healing:** when a cached selector fails, only that step
  regenerates. Two tiers with exact Command Log labels: **"Self-Healed via
  Cache"** (a previously cached selector resolves, no AI call) and
  **"Self-Healed via AI"** (original NL step + current DOM sent to the
  model, new selector generated and written back to cache). Flagged in
  Command Log, console, and Cloud runs UI.
- **Export:** "Get Code" ejects generated code to the spec file — and
  **permanently forfeits healing**: healing only exists while the prompt
  remains in code. Their framing: eject when you "need strict
  predictability for review and auditing." (You can have healing or
  reviewable code in the repo — never both — goldseam's thesis is that this
  is a false choice.)
- **Reports:** Cloud prompt reports (JSON/YAML/Markdown) per recorded run.
- **Limits:** E2E only; Chromium only (Chrome/Edge/Electron); **50 steps
  max per prompt**; per-user hourly metering; English-optimized; **no
  canvas, no iframes**, no `cy.request`/`cy.intercept` generation, no
  multi-element assertions, no cookie/session clearing.
- **Offline:** since the flag removal, the app calls
  `api.cypress.io/cy-prompt/session` — air-gapped runs break even without
  invoking cy.prompt
  ([#33927](https://github.com/cypress-io/cypress/issues/33927)).

### Version timeline (changelog)

| Version | Date | Change |
| --- | --- | --- |
| 15.4.0 | 2025-10-07 | `cy.prompt` reserved; invite-gated behind `experimentalPromptCommand` |
| 15.6.0 | 2025-11-04 | "Self-healed" badge added to Command Log |
| 15.13.0 | 2026-03-24 | Beta; flag removed; any Cloud login or record key |

### Demand evidence (the niche, in their own issue queue)

- [#20458](https://github.com/cypress-io/cypress/issues/20458) (2022,
  self-healing for existing scripts) — years of "any update?" comments,
  closed with *"this is addressed via cy.prompt."*
- [#30805](https://github.com/cypress-io/cypress/issues/30805) (same ask) —
  closed as duplicate. No public plan to heal existing `cy.get` suites.
- [#32673](https://github.com/cypress-io/cypress/issues/32673) — open
  request for BYO API keys / custom OpenAI-compatible endpoints
  (BASE_URL, MODEL_ID, API_KEY): the RepairRunner, requested by their own
  users.

Usage patterns extracted from the full issue sweep live in
[cy-prompt-usage.md](cy-prompt-usage.md).

## What we adopt, counter, and skip

| cy.prompt capability | goldseam response |
| --- | --- |
| Heals prompt-authored steps only | **Counter:** heal existing unmodified `cy.get` suites — the installed base |
| Cloud-hosted LLM, no BYO model | **Counter:** pluggable runner — `claude -p`, any API, or local (Ollama) |
| Runtime selector substitution | **Counter:** build-time heal delivered as a reviewed PR (their "Get Code" validates the direction; we make it the product) |
| Step-scoped regeneration | **Adopt:** minimal exact-string edit of the broken selector only |
| Heal tiers (cache vs AI) + visibility | **Adopt:** tier labels in heal artifacts and PR bodies |
| Placeholder/sensitive-data redaction | **Adopt:** capture-time redaction pass (shipped) |
| Selector-priority config (ElementSelector) | **Adopt:** configurable priority for *proposed* selectors (`data-cy` > role > text > css) |
| Prompt reports (JSON/YAML/MD) | **Adopt:** capture + heal artifacts are already JSON; add a summary report |
| NL authoring vocabulary, refinement dialogs, Studio | **Skip:** authoring is a different product; don't fight a free incumbent there |
| Canvas/iframe support | **Skip (same wall):** both products exclude them; document honestly |
