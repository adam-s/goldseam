# Proving ground: PrairieLearn

goldseam against a real ~3GB production monorepo (PrairieLearn has no
Cypress of its own — Playwright only — so this is the first Cypress
pointed at it). Local-only; never runs in CI.

## Boot the app

Uses the warm-boot image from `~/Projects/Temp/prairielearn-debug`
(built once as `pl-debug:base`), serving the main PL checkout:

```bash
cd ~/Projects/Temp/prairielearn-debug
WORKTREE_PATH=~/Projects/Temp/PrairieLearn \
ARTIFACTS_DIR=/tmp/pl-goldseam/artifacts \
JOURNEY_ID=goldseam \
docker compose up -d --pull never
# app: http://127.0.0.1:3010/pl  (dev-admin auth via /pl/dev_login)
```

## Run

```bash
# from the goldseam repo root
env -u ELECTRON_RUN_AS_NODE npx cypress run --config-file proving/prairielearn/cypress.config.ts
```

Break a selector in `specs/`, run again, then `npx goldseam heal` — the
capture pipeline and heal ladder work here exactly as on the demo shop,
just with 100–800KB production DOMs.
