// Proving ground: OWASP Juice Shop (Angular Material SPA, id-based
// selector culture lifted from its own Cypress suite). Local-only.
//
// Boot: cd /tmp/goldseam-proving/juice-shop && npm start   (port 3000)
// Run (repo root): npx cypress run --config-file proving/juice-shop/cypress.config.ts
import { defineConfig } from 'cypress';
import goldseam from 'goldseam/plugin';

export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:3000',
    supportFile: 'proving/juice-shop/support.ts',
    specPattern: 'proving/juice-shop/specs/**/*.cy.ts',
    video: false,
    defaultCommandTimeout: 8000,
    setupNodeEvents(on, config) {
      return goldseam(on, config);
    },
  },
});
