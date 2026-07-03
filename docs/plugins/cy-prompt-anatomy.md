# cy.prompt anatomy — how the incumbent actually works

First-party evidence gathered 2026-07-03 from the Cypress 15.18.0 binary
installed at `~/Library/Caches/Cypress/15.18.0/`, plus official docs. This
is the competitive reference for qa-relocator's design.

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
   is exactly what qa-relocator does (see
   [extension-points.md](extension-points.md)).

## Documented behavior (docs + blog, July 2026)

- **Input:** `cy.prompt(steps: string[], { placeholders? })` — English
  steps; `{{placeholder}}` values are excluded from AI calls and from cache
  identity.
- **Translation:** Cloud-hosted LLMs convert steps to Cypress commands using
  page context; sensitive DOM data (passwords, credit cards, hidden inputs)
  auto-excluded.
- **Caching:** generated code cached after first run, shared across
  machines/CI; repeat runs make no AI calls; cache invalidated by prompt or
  DOM changes.
- **Self-healing:** when a cached selector fails, only that step
  regenerates. Two tiers: *healed via cache* (no AI call) and *healed via
  AI*. Heals are flagged in the Command Log, console, and Cloud runs UI.
- **Export:** "Get Code" shows/exports generated code to the spec file —
  their own escape hatch from runtime magic into version control.
- **Reports:** Cloud prompt reports (JSON/YAML/Markdown) per recorded run.
- **Limits:** E2E only; Chromium only; **no canvas, no iframes**; English
  only; metered per-org via Cloud with per-user hourly limits.

## What we adopt, counter, and skip

| cy.prompt capability | qa-relocator response |
|---|---|
| Heals prompt-authored steps only | **Counter:** heal existing unmodified `cy.get` suites — the installed base |
| Cloud-hosted LLM, no BYO model | **Counter:** pluggable runner — `claude -p`, any API, or local (Ollama) |
| Runtime selector substitution | **Counter:** build-time heal delivered as a reviewed PR (their "Get Code" validates the direction; we make it the product) |
| Step-scoped regeneration | **Adopt:** minimal exact-string edit of the broken selector only |
| Heal tiers (cache vs AI) + visibility | **Adopt:** tier labels in heal artifacts and PR bodies |
| Placeholder/sensitive-data redaction | **Adopt:** capture-time redaction pass (M4 checklist) |
| Selector-priority config (ElementSelector) | **Adopt:** configurable priority for *proposed* selectors (`data-cy` > role > text > css) |
| Prompt reports (JSON/YAML/MD) | **Adopt:** capture + heal artifacts are already JSON; add a summary report |
| NL authoring vocabulary, refinement dialogs, Studio | **Skip:** authoring is a different product; don't fight a free incumbent there |
| Canvas/iframe support | **Skip (same wall):** both products exclude them; document honestly |
