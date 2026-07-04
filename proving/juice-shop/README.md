# Proving ground: OWASP Juice Shop

Angular Material SPA; bare-id selector culture lifted from its own
Cypress suite (#email, #password, #loginButton). Local-only.

## Boot

```bash
git clone --depth 20 https://github.com/juice-shop/juice-shop /tmp/goldseam-proving/juice-shop
cd /tmp/goldseam-proving/juice-shop && npm install --legacy-peer-deps && npm start   # port 3000
```

## Run

```bash
env -u ELECTRON_RUN_AS_NODE npx cypress run --config-file proving/juice-shop/cypress.config.ts
node packages/goldseam/dist/cli/index.js heal --model claude --config-file proving/juice-shop/cypress.config.ts
```

Drift: `perl -pi -e 's/loginButton/signinButton/g' frontend/dist/frontend/main.js` in the clone.

## Results (2026-07-04)

- Green baseline 2/2 (welcome banner + cookie bar pre-dismissed via
  cookies, same trick as upstream's own suite).
- Drift `#loginButton→#signinButton` in the built bundle: two captures
  (~500KB Angular DOMs); Sonnet healed both sites to
  `[aria-label="Login"]` — a semantic aria-attribute selector.
- Plausible-absent probe (`#biometricLoginButton`, scenarios/): honest
  model give-up with independent judgment — "no plausible target element
  to remap". First attempt was CONTAMINATED (the scenario comment told
  the model the element was deliberately absent, and it quoted the
  comment back); proofs must be hint-free because spec comments are
  model-visible prompt surface.
- **Three goldseam bugs found and fixed this leg:** a comment mentioning
  the broken selector defeated the sibling-heal probe (substring check →
  string-literal-aware check), which made re-runs burn model calls on
  already-healed captures and overwrite healed artifacts with gave-ups;
  and jsdom's CSS parser spammed the CLI on @layer stylesheets
  (VirtualConsole now everywhere jsdom is constructed).
