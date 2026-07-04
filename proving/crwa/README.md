# Proving ground: Cypress Real World App

The incumbent's own showcase (React + MUI, data-test culture). Local-only.

## Boot

```bash
git clone --depth 20 https://github.com/cypress-io/cypress-realworld-app /tmp/goldseam-proving/cypress-realworld-app
cd /tmp/goldseam-proving/cypress-realworld-app && yarn install && yarn start  # UI 3000, API 3001
```

Port hygiene matters: anything else on 3000/3001 (Juice Shop, Shoelace's
reload socket) silently steals the UI — the capture's aria tree is the
fastest diagnosis (it literally named the wrong app).

## Run

```bash
env -u ELECTRON_RUN_AS_NODE npx cypress run --config-file proving/crwa/cypress.config.ts
node packages/goldseam/dist/cli/index.js heal --model claude --config-file proving/crwa/cypress.config.ts
```

Drift: rename `data-test="signin-submit"` in src/components/SignInForm.tsx
(CRA hot-recompiles).

## Results (2026-07-04)

- Green baseline 2/2. Drift broke both tests → two captures.
- Sonnet healed capture 1 with a THREE-edit multi-site heal to
  `button[type="submit"]` (0.72, full ladder); capture 2 sibling-healed
  at attempt 0 with zero model calls.
- Adopter guidance surfaced: the model chose semantic CSS over the
  drifted `data-test` value because `data-test` isn't in the default
  selectorPriority — teams using data-test should add it
  (`selectorPriority: ['data-test', ...]`).
