// The adopter's story as a CI job: a selector drifts, the test goes red,
// the capture artifact appears, `goldseam heal` repairs it (deterministic
// stub — no model calls in CI), and the run's own summary shows the
// verdict ladder + report exactly as a team would see them. The .goldseam
// dir is left in place for artifact upload.

import { appendFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import cypress from 'cypress';
import { healableSpec, runCli, startServer } from './lib/harness.mjs';

const TMP_SPEC = 'cypress/system/tmp-healable.cy.ts';
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const summary = (md) => (summaryFile ? appendFileSync(summaryFile, md + '\n') : console.log(md));

const server = await startServer('demo', 4173);
let failed = false;
try {
  rmSync('.goldseam', { recursive: true, force: true });

  writeFileSync(TMP_SPEC, healableSpec('[data-testid="buy-now-5"]'));
  const red = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  if (red.totalFailed !== 1) throw new Error(`expected the drifted spec to fail once, got ${red.totalFailed}`);

  const heal = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs fix']);
  process.stdout.write(heal.stdout);
  if (heal.status !== 0 || !heal.stdout.includes('[healed]')) throw new Error('heal did not succeed');

  const healedSpec = readFileSync(TMP_SPEC, 'utf8');
  const healedLine = healedSpec.split('\n').find((l) => l.includes('add-to-cart-5'))?.trim();
  if (!healedLine) throw new Error('healed spec carries no add-to-cart-5 line — heal output unexpected');
  const artifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  const report = runCli(['report', '--format', 'md', '--out', '.goldseam/report.md']);
  if (report.status !== 0) throw new Error('goldseam report failed');

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
  summary(`+ ${healedLine}`);
  summary('```');
  summary('\n' + readFileSync('.goldseam/report.md', 'utf8'));
  console.log('\nSHOWCASE PASSED');
} catch (e) {
  failed = true;
  console.error(`SHOWCASE FAILED: ${e instanceof Error ? e.message : e}`);
} finally {
  server.stop();
  rmSync(TMP_SPEC, { force: true }); // .goldseam intentionally kept for artifact upload
}
process.exit(failed ? 1 : 0);
