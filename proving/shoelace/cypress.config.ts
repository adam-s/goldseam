// Proving ground: Shoelace docs (web components — every sl-* element
// renders into an OPEN shadow root). The suite culture for component
// libraries: includeShadowDom + part/class selectors that live inside
// shadow trees. Local-only.
//
// Boot: cd /tmp/goldseam-proving/shoelace && npm start   (port 4000)
// Run (repo root): npx cypress run --config-file proving/shoelace/cypress.config.ts
import { defineConfig } from 'cypress';
import goldseam from 'goldseam/plugin';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4000',
    supportFile: 'proving/shoelace/support.ts',
    specPattern: 'proving/shoelace/specs/**/*.cy.ts',
    video: false,
    includeShadowDom: true,
    defaultCommandTimeout: 8000,
    setupNodeEvents(on, config) {
      return goldseam(on, config);
    },
  },
});
