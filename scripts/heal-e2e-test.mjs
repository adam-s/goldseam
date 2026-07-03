// End-to-end heal test (M3+M4 done-when), model-free via the cmd: stub:
//   1. a spec with a drifted selector fails → capture artifact
//   2. `goldseam heal` proposes, applies, and verifies through the full
//      ladder (propose → rerun-test → rerun-spec)
//   3. the spec file is edited, the heal artifact records the ladder
//   4. an unhealable capture produces a clean, reported give-up
//
// The real-model path is the same CLI with --model claude (Sonnet).

import { spawnSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import cypress from 'cypress';

delete process.env.ELECTRON_RUN_AS_NODE;

const TMP_SPEC = 'cypress/system/tmp-healable.cy.ts';
const CLI = 'packages/goldseam/dist/cli/index.js';

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
  rmSync('.goldseam', { recursive: true, force: true });

  console.log('\n— break: drifted selector fails and captures —');
  writeFileSync(
    TMP_SPEC,
    `describe('healable', () => {
  it('adds a mug to the cart', () => {
    cy.visit('/');
    cy.get('[data-testid="buy-now-5"]', { timeout: 2000 }).click();
    cy.get('#cart-count').should('have.text', '1');
  });
});
`,
  );
  const red = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  check(red.totalFailed === 1, 'drifted spec fails');
  check(existsSync('.goldseam/failures') && readdirSync('.goldseam/failures').length === 1, 'capture written');

  console.log('\n— heal: full ladder with the stub model —');
  const heal = spawnSync('node', [CLI, 'heal', '--model', 'cmd:node scripts/stub-model.mjs fix'], {
    encoding: 'utf8',
  });
  process.stdout.write(heal.stdout);
  check(heal.status === 0, 'heal CLI exits 0');

  const healedSpec = readFileSync(TMP_SPEC, 'utf8');
  check(healedSpec.includes('add-to-cart-5'), 'spec selector was edited');
  check(!healedSpec.includes('buy-now-5'), 'old selector is gone');
  check(healedSpec.includes(`should('have.text', '1')`), 'assertion untouched');

  const healFiles = readdirSync('.goldseam/heals');
  check(healFiles.length === 1, 'heal artifact written');
  const healArtifact = JSON.parse(readFileSync(`.goldseam/heals/${healFiles[0]}`, 'utf8'));
  check(healArtifact.verdict === 'healed', 'verdict: healed');
  const rungs = healArtifact.attempts.at(-1).ladder.map((r) => `${r.stage}:${r.verdict}`);
  check(
    JSON.stringify(rungs) === JSON.stringify(['propose:pass', 'rerun-test:pass', 'rerun-spec:pass']),
    `full ladder recorded (${rungs.join(' → ')})`,
  );
  check(healArtifact.tier === 'model' && healArtifact.model.startsWith('cmd:'), 'tier + model recorded');

  console.log('\n— healed spec actually passes —');
  const green = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  check(green.totalFailed === 0 && green.totalPassed === 1, 'healed spec is green');

  console.log('\n— give-up: unhealable capture reported, nothing touched —');
  rmSync('.goldseam', { recursive: true, force: true });
  writeFileSync(
    TMP_SPEC,
    `describe('healable', () => {
  it('adds a mug to the cart', () => {
    cy.visit('/');
    cy.get('[data-testid="buy-now-5"]', { timeout: 2000 }).click();
  });
});
`,
  );
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  const before = readFileSync(TMP_SPEC, 'utf8');
  const giveup = spawnSync('node', [CLI, 'heal', '--model', 'cmd:node scripts/stub-model.mjs giveup'], {
    encoding: 'utf8',
  });
  check(giveup.status === 0 && giveup.stdout.includes('[gave-up]'), 'give-up reported, exit 0');
  check(readFileSync(TMP_SPEC, 'utf8') === before, 'spec untouched on give-up');
  const giveupArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  check(giveupArtifact.verdict === 'gave-up', 'give-up recorded as first-class verdict');
} finally {
  server.kill();
  rmSync(TMP_SPEC, { force: true });
  rmSync('.goldseam', { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nHEAL E2E FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nHEAL E2E PASSED');
