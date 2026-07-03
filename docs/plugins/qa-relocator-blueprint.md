# qa-relocator — product blueprint

The target: a professional plugin + CLI that heals existing Cypress suites
with a self-hosted model, shaped by the paradigms in
[patterns.md](patterns.md) and the capability bar in
[cy-prompt-anatomy.md](cy-prompt-anatomy.md).

## Positioning (one sentence)

Self-healing for the Cypress suites you already have: failures become rich
captures, your model (local or API) proposes a minimal selector fix, the
suite verifies it, and it arrives as a pull request — no cloud, no rewrite,
no runtime magic.

## User-facing surface

```ts
// cypress/support/e2e.ts
import { installQaRelocator } from 'qa-relocator/support'
installQaRelocator()          // zero-config default

// cypress.config.ts
import { qaRelocator } from 'qa-relocator/plugin'
setupNodeEvents(on, config) {
  qaRelocator(on, config)
  return config
}
```

```bash
qa-relocator heal                     # read failures, propose+verify fixes
qa-relocator heal --model ollama:qwen3 --dry-run
qa-relocator pr                       # open PR(s) from verified heals
qa-relocator report                   # summary (md/json) of captures+heals
```

### Options (all optional; defaults first)

| Option | Side | Default | Purpose |
|---|---|---|---|
| `failuresDir` | both | `.qa-relocator/failures` | Artifact location |
| `redact` | support | `true` | Strip value-bearing attributes, mask email/number-like text in captures |
| `maxDomBytes` | support | `1 MB` | Truncation cap with truncation marker in artifact |
| `ariaSnapshot` | support | `true` | Include a11y YAML (via `@qa-relocator/aria-snapshot`) |
| `selectorPriority` | cli | `['data-cy','data-testid','role','text','css']` | Order the model is told to prefer |
| `model` | cli | `claude` | Runner id: `claude`, `openai:<model>`, `ollama:<model>`, `cmd:<exe>` |
| `giveUpOn` | cli | `['about:blank','captureError']` | Signals that force a no-heal verdict |

## Architecture (paradigm 5: artifacts + CLI)

```
┌────────── cypress run ──────────┐   ┌───────────── after the run ─────────────┐
│ support: fail → stash → rethrow │   │ CLI: heal                                │
│ afterEach → cy.task ────────────┼──►│  read artifact → build prompt →          │
│ plugin: validate + write        │   │  model runner → strict-JSON edit →       │
│   .qa-relocator/failures/*.json │   │  apply → verify (Module API, grep'd) →   │
└─────────────────────────────────┘   │  oracle check → heal artifact            │
                                      │ CLI: pr → branch, commit, PR body        │
                                      └──────────────────────────────────────────┘
```

Invariants carried from the teaching build (non-negotiable, tested):

1. No `cy.*` in `fail`; stash + re-throw; capture failures never mask test
   failures (`finally { throw err }`).
2. Captures are best-effort and quiet on green runs.
3. The repair model sees runtime snapshots only — never app source.
4. Heals never weaken assertions; a heal is a selector-only, exact-string,
   minimal edit.
5. Every heal is a reviewed commit. No runtime substitution, ever.
6. Give-up is a first-class outcome (degraded capture, no plausible target,
   low confidence) and is reported, not hidden.

## Artifact schema (public API, versioned)

```jsonc
// .qa-relocator/failures/<slug>-<hash6>.json
{
  "schemaVersion": 2,
  "title": "…full test title…",
  "specPath": "cypress/e2e/…",
  "errorMessage": "…original assertion/command error…",
  "url": "https://…",                // 'about:blank' ⇒ give-up signal
  "domHtml": "…redacted outerHTML…",
  "ariaSnapshot": "…Playwright-format YAML…",
  "captureError": "…present only if capture degraded…",
  "failedSelector": "…parsed from errorMessage when derivable…",   // v2 idea
  "cypressVersion": "15.18.0",                                      // v2 idea
  "capturedAt": "ISO-8601"                                          // v2 idea
}
```

Heal artifacts (`.qa-relocator/heals/`) mirror this: input capture ref,
proposed edit, model + tier (`cache` | `model`), confidence, verify results
(single test, full suite, oracle), verdict.

## The model runner interface (the self-hosted key)

```ts
interface RepairRunner {
  repair(input: RepairPrompt): Promise<RepairReply>  // strict JSON both ways
}
```

- `claude` runner: `claude -p --output-format json` (zero-setup for Claude
  users; no SDK dependency).
- `openai:`/`anthropic:` runners: plain HTTPS with user's key.
- `ollama:` runner: local HTTP — the air-gapped story.
- `cmd:` runner: spawn any executable, JSON on stdio — the ultimate escape
  hatch; lets teams wrap anything.

The prompt contract and reply schema live beside the artifact schema —
they're the same doc family. Reply: `{ edits: [{file, oldString,
newString}], confidence, reasoning, giveUp?: {reason} }`.

## Verification loop (M5, CLI-side)

1. Apply edit to a working copy.
2. Single-test rerun via Module API + `@cypress/grep`.
3. Full-spec rerun (blast-radius check).
4. **Oracle check** (benchmark mode): healed selector must resolve to the
   element the mutation intended — candidate implementation:
   `matchesAriaTree` from `@qa-relocator/aria-snapshot`, comparing the
   healed target's aria identity against the pre-mutation capture.
5. Revert on any failure; record verdict either way.

## Monorepo layout (end state)

```
packages/
  aria-snapshot/     # shipped: standalone, already built
  qa-relocator/      # plugin (support+plugin entries) + CLI + runners
demo/                # fixture shop (also the system-test app)
cypress/             # dogfood suite — the repo uses its own plugin
docs/plugins/        # this knowledge base
```

## Launch assets (M6 = marketing)

- The benchmark table: N mutation branches, M broken tests, heal rate,
  tier breakdown, per-selector-style results (which selector styles heal
  best — data nobody else publishes).
- A 90-second demo: break a selector → CI red → `qa-relocator heal` → PR
  appears with reasoning in the body.
- The cy-prompt-anatomy write-up as a technical blog post — "we read the
  loader in the binary" earns the audience that matters.

## Idea backlog (beyond parity)

- **Selector flakiness telemetry** (`command:retry` counts) — surfaced in
  `qa-relocator report`; pre-emptive healing candidates.
- **Heal memory:** verified heals keyed by (selector, aria-identity) reapply
  as `healed-via-cache` on other branches before any model call.
- **`--suggest-testids` mode:** after healing, optionally propose a
  follow-up diff adding `data-cy` attributes to the app for the healed
  elements — turns healing into prevention (clearly separated from the
  heal PR; touches app source only with explicit opt-in).
- **GitHub Action:** `qa-relocator/action` wrapping heal+pr on workflow
  failure events.
- **Multi-framework future:** the artifact schema is deliberately
  Cypress-agnostic (DOM + aria + error); a Playwright capture shim could
  feed the same CLI. Name the schema accordingly from day one.
