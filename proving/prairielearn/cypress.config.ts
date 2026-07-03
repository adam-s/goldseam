// Real-world proving ground: goldseam against PrairieLearn (a ~3GB
// production TypeScript monorepo, ~500k LoC, Bootstrap UI, socket.io).
// PL has no Cypress of its own (Playwright only) — this config is the
// first Cypress ever pointed at it, wired through goldseam exactly like
// any adopting project.
//
// Boot the app first (see proving/prairielearn/README.md), then:
//   npx cypress run --config-file proving/prairielearn/cypress.config.ts
import { defineConfig } from 'cypress';
import goldseam from 'goldseam/plugin';

export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:3010',
    supportFile: 'proving/prairielearn/support.ts',
    specPattern: 'proving/prairielearn/specs/**/*.cy.ts',
    video: false,
    setupNodeEvents(on, config) {
      return goldseam(on, config);
    },
  },
});
