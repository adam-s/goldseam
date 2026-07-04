// Proving ground: Cypress Real World App — the incumbent's own showcase.
// Pure data-test selector culture. Local-only.
//
// Boot: cd /tmp/goldseam-proving/cypress-realworld-app && yarn start  (UI 3000, API 3001)
// Run (repo root): npx cypress run --config-file proving/crwa/cypress.config.ts
import { defineConfig } from 'cypress';
import goldseam from 'goldseam/plugin';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    supportFile: 'proving/crwa/support.ts',
    specPattern: 'proving/crwa/specs/**/*.cy.ts',
    video: false,
    defaultCommandTimeout: 8000,
    setupNodeEvents(on, config) {
      return goldseam(on, config);
    },
  },
});
