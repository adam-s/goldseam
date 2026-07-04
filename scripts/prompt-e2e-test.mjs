// cy.goldseam() authoring E2E (parity with cy.prompt, minus the cloud):
//   1. first run translates via the (stub) model → committable cache file
//   2. second run replays from cache with a model that would fail if asked
//   3. placeholder values never appear in the cache
//   4. eject renders the cache as plain Cypress code

import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import cypress from 'cypress';
import { check, finish, runCli, startServer } from './lib/harness.mjs';

const require = createRequire(import.meta.url);
const { promptKey } = require('../packages/goldseam/dist/shared/prompt-types.js');

const TMP_SPEC = 'cypress/system/tmp-prompt.cy.ts';
const STEPS = ['Go to the shop', 'Add the Ember Mug to the cart', 'The cart count should show {{qty}}'];
const KEY = promptKey(STEPS);
const CACHE_FILE = `.goldseam-prompts/${KEY}.json`;

const server = await startServer('demo', 4173);

try {
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
  // `wait` is exempt: its numeric ms rendered as a string can coincide with
  // a placeholder value like '1' without being a leak.
  check(!JSON.parse(cache).commands.some((c) => c.value === '1' && c.action !== 'wait'), 'placeholder VALUE never cached');

  console.log('\n— second run: cache replays with zero model calls —');
  process.env.GOLDSEAM_PROMPT_MODEL = 'cmd:node scripts/stub-model.mjs giveup'; // invalid for translation — errors if consulted
  const second = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  check(second.totalPassed === 1 && second.totalFailed === 0, 'authored test replays green from cache');

  console.log('\n— eject renders the cache as plain Cypress code —');
  const eject = runCli(['eject']);
  check(eject.status === 0 && eject.stdout.includes(`cy.get('[data-testid="add-to-cart-5"]').click();`), 'eject prints executable code');
  check(eject.stdout.includes('// Go to the shop'), 'eject keeps the English steps as comments');
} finally {
  server.stop();
  rmSync(TMP_SPEC, { force: true });
  rmSync(CACHE_FILE, { force: true });
  rmSync('.goldseam', { recursive: true, force: true });
  delete process.env.GOLDSEAM_PROMPT_MODEL;
}

finish('PROMPT E2E');
