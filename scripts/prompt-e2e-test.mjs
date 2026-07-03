// cy.goldseam() authoring E2E (parity with cy.prompt, minus the cloud):
//   1. first run translates via the (stub) model → committable cache file
//   2. second run replays from cache with a model that would fail if asked
//   3. placeholder values never appear in the cache
//   4. eject renders the cache as plain Cypress code

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import cypress from 'cypress';

delete process.env.ELECTRON_RUN_AS_NODE;

const require = createRequire(import.meta.url);
const { promptKey } = require('../packages/goldseam/dist/shared/prompt-types.js');

const TMP_SPEC = 'cypress/system/tmp-prompt.cy.ts';
const CLI = 'packages/goldseam/dist/cli/index.js';
const STEPS = ['Go to the shop', 'Add the Ember Mug to the cart', 'The cart count should show {{qty}}'];
const KEY = promptKey(STEPS);
const CACHE_FILE = `.goldseam-prompts/${KEY}.json`;

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}`);
  if (!ok) failures++;
};

const server = spawn('npx', ['http-server', 'demo', '-p', '4173', '-c-1', '--silent'], {
  stdio: 'ignore',
});

try {
  await new Promise((r) => setTimeout(r, 1500));
  rmSync(CACHE_FILE, { force: true });
  writeFileSync(
    TMP_SPEC,
    `describe('authored', () => {
  it('adds a mug via natural language', () => {
    cy.goldseam(${JSON.stringify(STEPS)}, { placeholders: { qty: '1' } });
  });
});
`,
  );

  console.log('\n— first run: steps translate through the model and cache —');
  process.env.GOLDSEAM_PROMPT_MODEL = 'cmd:node scripts/stub-model.mjs translate';
  const first = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  check(first.totalPassed === 1 && first.totalFailed === 0, 'authored test passes on first run');
  check(existsSync(CACHE_FILE), 'translation cached as a committable file');
  const cache = readFileSync(CACHE_FILE, 'utf8');
  check(cache.includes('{{qty}}'), 'placeholder token survives into the cache');
  check(!JSON.parse(cache).commands.some((c) => c.value === '1' && c.action !== 'wait'), 'placeholder VALUE never cached');

  console.log('\n— second run: cache replays with zero model calls —');
  process.env.GOLDSEAM_PROMPT_MODEL = 'cmd:node scripts/stub-model.mjs giveup'; // invalid for translation — errors if consulted
  const second = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  check(second.totalPassed === 1 && second.totalFailed === 0, 'authored test replays green from cache');

  console.log('\n— eject renders the cache as plain Cypress code —');
  const eject = spawnSync('node', [CLI, 'eject'], { encoding: 'utf8' });
  check(eject.status === 0 && eject.stdout.includes(`cy.get('[data-testid="add-to-cart-5"]').click();`), 'eject prints executable code');
  check(eject.stdout.includes('// Go to the shop'), 'eject keeps the English steps as comments');
} finally {
  server.kill();
  rmSync(TMP_SPEC, { force: true });
  rmSync(CACHE_FILE, { force: true });
  rmSync('.goldseam', { recursive: true, force: true });
  delete process.env.GOLDSEAM_PROMPT_MODEL;
}

if (failures > 0) {
  console.error(`\nPROMPT E2E FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nPROMPT E2E PASSED');
