# Proving ground: TodoMVC (javascript-es6 variant)

The canonical zero-hooks selector culture: semantic classes only
(`.new-todo`, `.todo-list`, `.toggle`). Local-only; never in CI.

## Boot

```bash
npx http-server /tmp/goldseam-proving/todomvc/examples/javascript-es6/dist -p 4180 -c-1
```

Clone first: `git clone --depth 20 https://github.com/tastejs/todomvc /tmp/goldseam-proving/todomvc`.

## Run

```bash
env -u ELECTRON_RUN_AS_NODE npx cypress run --config-file proving/todomvc/cypress.config.ts
node packages/goldseam/dist/cli/index.js heal --model claude --config-file proving/todomvc/cypress.config.ts
```

Drift is induced in the /tmp copy (`perl -pi -e 's/clear-completed/purge-done/g' dist/*`),
never in this repo — specs here always match upstream.

## Results (2026-07-04)

- Green baseline 4/4; green run writes nothing.
- Drift `clear-completed→purge-done`: captured (3.8KB DOM, failedSelector
  parsed), Sonnet healed to `.purge-done` (confidence 0.97) through
  triage → propose → resolve → oracle(skip) → rerun-test → rerun-spec.
- Leg 2 (hook drift `.new-todo→.task-entry`): beforeEach failure aborts
  the describe — one capture with mocha's hook title. Found that hook
  heals could never pass the rerun verdict (title matching), that
  identical rejected proposals burned the full retry budget, and that
  the weak-assertion flag misjudged hook heals. All three fixed and
  pinned; Sonnet then healed the two-edit hook drift in one attempt.
- **Two goldseam bugs found and fixed leg 1:** the CLI inherited
  `ELECTRON_RUN_AS_NODE` from VS Code terminals and every rerun rung
  died ("Could not find Cypress test run results") — the CLI now strips
  it; and the engine burned three identical model calls retrying that
  infrastructure failure — it now aborts the heal when Cypress itself
  cannot run.
