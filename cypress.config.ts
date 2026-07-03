import { defineConfig } from 'cypress';
import { goldseam } from 'goldseam/plugin';

export default defineConfig({
  e2e: {
    // The demo shop (also the system-test fixture). Serve with `npm run demo`
    // (static files from demo/, port 4173) before running specs.
    baseUrl: 'http://localhost:4173',
    video: false,
    setupNodeEvents(on, config) {
      goldseam(on, config);
      return config;
    },
  },
});
