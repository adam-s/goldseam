// The adopter's story as a CI job: a selector drifts, the test goes red,
// the capture artifact appears, `goldseam heal` repairs it (deterministic
// stub — no model calls in CI), and the run's own summary shows the
// verdict ladder + report exactly as a team would see them. The .goldseam
// dir is left in place for artifact upload.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import cypress from 'cypress';

delete process.env.ELECTRON_RUN_AS_NODE;

const TMP_SPEC = 'cypress/system/tmp-healable.cy.ts';
const CLI = 'packages/goldseam/dist/cli/index.js';
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const summary = (md) => (summaryFile ? appendFileSync(summaryFile, md + '\n') : console.log(md));

const server = spawn('npx', ['http-server', 'demo', '-p', '4173', '-c-1', '--silent'], { stdio: 'ignore' });
let failed = false;
try {
  await new Promise((r) => setTimeout(r, 1500));
  rmSync('.goldseam', { recursive: true, force: true });

  const BROKEN = `describe('healable', () => {
  it('adds a mug to the cart', () => {
    cy.visit('/');
    cy.get('[data-testid="buy-now-5"]', { timeout: 2000 }).click();
    cy.get('#cart-count').should('have.text', '1');
  });
});
`;
  writeFileSync(TMP_SPEC, BROKEN);
  const red = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  if (red.totalFailed !== 1) throw new Error(`expected the drifted spec to fail once, got ${red.totalFailed}`);

  const heal = spawnSync('node', [CLI, 'heal', '--model', 'cmd:node scripts/stub-model.mjs fix'], {
    encoding: 'utf8',
  });
  process.stdout.write(heal.stdout);
  if (heal.status !== 0 || !heal.stdout.includes('[healed]')) throw new Error('heal did not succeed');

  const healedSpec = readFileSync(TMP_SPEC, 'utf8');
  const artifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  spawnSync('node', [CLI, 'report', '--format', 'md', '--out', '.goldseam/report.md'], { encoding: 'utf8' });

  summary('## goldseam self-heal showcase');
  summary('A selector drifted, the test went red, and the pipeline delivered a reviewed fix — no model calls (deterministic stub):');
  summary('\n**Verdict ladder** (every rung recorded in the heal artifact):\n');
  summary('| rung | verdict | evidence |');
  summary('| --- | --- | --- |');
  for (const rung of artifact.attempts.at(-1).ladder) {
    summary(`| ${rung.stage} | ${rung.verdict} | ${rung.evidence.replace(/\|/g, '\\|').slice(0, 120)} |`);
  }
  summary('\n**The healed edit** (selector-only, exact-string — assertions untouched):\n');
  summary('```diff');
  summary(`- cy.get('[data-testid="buy-now-5"]', { timeout: 2000 }).click();`);
  summary(`+ ${healedSpec.split('\n').find((l) => l.includes('add-to-cart-5'))?.trim()}`);
  summary('```');
  summary('\n' + readFileSync('.goldseam/report.md', 'utf8'));
  console.log('\nSHOWCASE PASSED');
} catch (e) {
  failed = true;
  console.error(`SHOWCASE FAILED: ${e instanceof Error ? e.message : e}`);
} finally {
  server.kill();
  rmSync(TMP_SPEC, { force: true }); // .goldseam intentionally kept for artifact upload
}
process.exit(failed ? 1 : 0);
