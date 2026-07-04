# Proving campaign — 2026-07-04 overnight run

Recursive iteration over real open-source apps (Adam's authorization:
"choose 4 more candidates and run the iterations"). Pattern per app:
clone to `/tmp/goldseam-proving/<app>`, boot locally, write specs in the
app's native selector culture, green baseline, induce realistic drift in
the /tmp copy, drive capture → heal (stub for mechanics, real Sonnet for
proving moments) and `cy.goldseam` authoring — every goldseam stumble
becomes a fix + pinned test + one conventional commit.

| App | Culture | Status |
| --- | --- | --- |
| PrairieLearn | Bootstrap prod monorepo, data-testid | done 2026-07-03 (2 real bugs) |
| TodoMVC (js-es6) | semantic classes, zero hooks | leg 1 done: real heal ✓, 2 bugs fixed |
| Juice Shop | Angular Material, id/class/aria soup | installing |
| Shoelace docs | web components, shadow DOM | installing |
| Cypress RWA | React, data-test everywhere | installing |

Boot notes:
- TodoMVC: `npx http-server /tmp/goldseam-proving/todomvc/examples/javascript-es6/dist -p 4180 -c-1`
- Juice Shop: `npm start` in the clone (port 3000, sqlite in-memory)
- Shoelace: `npm start` in the clone (docs dev server; note real port here)
- CRWA: `yarn dev` (UI 3000, API 3001) — boot AFTER Juice Shop is done (port clash)

Learnings land here as they happen; fixes land in the main packages with
pinned tests. Real-model calls: heals + translations only at proving
moments, never CI.

## Log

- 2026-07-04: campaign scaffolded; TodoMVC served, baseline suite written.
- 2026-07-04 TodoMVC leg 1: `.clear-completed→.purge-done` drift healed by
  Sonnet (0.97, one attempt) AFTER fixing two goldseam bugs it exposed:
  CLI must strip ELECTRON_RUN_AS_NODE (VS Code terminals break the rerun
  rungs), and infra failures must abort instead of re-proposing (3×
  identical model calls burned). Both pinned.
