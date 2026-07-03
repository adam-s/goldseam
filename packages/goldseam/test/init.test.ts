import { describe, expect, it } from 'vitest';
import { wireConfigSource, wireSupportSource } from '../src/cli/init';

describe('wireSupportSource', () => {
  it('prepends the register import to an ESM support file', () => {
    const r = wireSupportSource(`import './commands';\n`);
    expect(r.changed).toBe(true);
    expect(r.source.startsWith(`import 'goldseam/support/register';`)).toBe(true);
    expect(r.source).toContain(`import './commands';`);
  });

  it('uses require() in a CJS support file', () => {
    const r = wireSupportSource(`const cmds = require('./commands');\n`);
    expect(r.source.startsWith(`require('goldseam/support/register');`)).toBe(true);
  });

  it('is idempotent', () => {
    const once = wireSupportSource('').source;
    expect(wireSupportSource(once).changed).toBe(false);
  });
});

const TS_CONFIG = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on, config) {
      return config;
    },
  },
});
`;

describe('wireConfigSource', () => {
  it('wires a method-style setupNodeEvents and adds the import after existing imports', () => {
    const r = wireConfigSource(TS_CONFIG);
    expect(r.changed).toBe(true);
    expect(r.source).toContain(`import { defineConfig } from 'cypress';\nimport goldseam from 'goldseam/plugin';`);
    expect(r.source).toContain(`setupNodeEvents(on, config) {\n      goldseam(on, config);`);
  });

  it('respects renamed parameters', () => {
    const r = wireConfigSource(`setupNodeEvents(cypressOn, cfg) {\n  return cfg;\n}`);
    expect(r.source).toContain('goldseam(cypressOn, cfg);');
  });

  it('handles arrow-function style', () => {
    const r = wireConfigSource(`export default { e2e: { setupNodeEvents: (on, config) => {\n  return config;\n} } };`);
    expect(r.changed).toBe(true);
    expect(r.source).toContain('goldseam(on, config);');
  });

  it('handles async setupNodeEvents', () => {
    const r = wireConfigSource(`async setupNodeEvents(on, config) {\n  return config;\n}`);
    expect(r.changed).toBe(true);
  });

  it('falls back to instructions when setupNodeEvents is absent', () => {
    const r = wireConfigSource(`export default { e2e: { baseUrl: 'http://x' } };`);
    expect(r.changed).toBe(false);
    expect(r.instructions).toContain('goldseam(on, config)');
  });

  it('is idempotent', () => {
    const once = wireConfigSource(TS_CONFIG).source;
    expect(wireConfigSource(once).changed).toBe(false);
  });

  it('uses require() wiring in CJS configs', () => {
    const r = wireConfigSource(
      `const { defineConfig } = require('cypress');\nmodule.exports = defineConfig({ e2e: { setupNodeEvents(on, config) {\n  return config;\n} } });`,
    );
    expect(r.source).toContain(`const { goldseam } = require('goldseam/plugin');`);
    expect(r.source).toContain('goldseam(on, config);');
  });
});
