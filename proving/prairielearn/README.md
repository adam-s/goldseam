# Proving ground: PrairieLearn

goldseam against a real ~3GB production monorepo (PrairieLearn has no
Cypress of its own — Playwright only — so this is the first Cypress
pointed at it). Local-only; never runs in CI.

## Boot the app

The upstream image is self-contained (Postgres/Redis/S3 inside, example
course preloaded):

```bash
docker run -d --rm --name pl-goldseam -p 3010:3000 prairielearn/prairielearn
# app: http://127.0.0.1:3010/pl  (dev-admin auth via /pl/dev_login)
```

(A pre-baked warm-boot image also works, but its baked node_modules must
match the mounted checkout's commit — the upstream image avoids that drift.)

## Run

```bash
# from the goldseam repo root
env -u ELECTRON_RUN_AS_NODE npx cypress run --config-file proving/prairielearn/cypress.config.ts
```

Break a selector in `specs/`, run again, then `npx goldseam heal` — the
capture pipeline and heal ladder work here exactly as on the demo shop,
just with 100–800KB production DOMs.

## Result (2026-07-03)

Green baseline (3/3) against the live example course, then broke
`[data-testid="table-scroll-container"]` → a drifted name. goldseam
captured the 192KB production DOM, and Sonnet healed it to `[role="grid"]`
(a semantic-role selector from our priority order), verified green through
`propose → rerun-test → rerun-spec` (confidence 0.82). Two real bugs the
run surfaced and fixed: artifacts must anchor to `config.projectRoot`
(not cwd), and `heal` needs `--config-file` for per-app configs.
