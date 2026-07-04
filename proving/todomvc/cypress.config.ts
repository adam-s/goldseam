// Proving ground: TodoMVC (tastejs/todomvc, javascript-es6 variant served
// from its prebuilt dist/). Canonical class-based selector culture
// (.new-todo, .todo-list, .toggle) — the "no test hooks, semantic
// classes" end of the spectrum. Local-only; never runs in CI.
//
// Boot: npx http-server /tmp/goldseam-proving/todomvc/examples/javascript-es6/dist -p 4180 -c-1
// Run (repo root): npx cypress run --config-file proving/todomvc/cypress.config.ts
import { defineConfig } from 'cypress';
import goldseam from 'goldseam/plugin';

export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:4180',
    supportFile: 'proving/todomvc/support.ts',
    specPattern: 'proving/todomvc/specs/**/*.cy.ts',
    video: false,
    setupNodeEvents(on, config) {
      return goldseam(on, config);
    },
  },
});
