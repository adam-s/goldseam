// The benchmark: apply each mutation from bench/mutations.json to the
// demo app, capture the breakage, run `goldseam heal`, and score the
// outcome against the mutation's expectation. Heal-rate by selector style
// is the launch table — data no incumbent publishes.
//
//   node scripts/benchmark.mjs                 # model: claude (Sonnet)
//   node scripts/benchmark.mjs --model "cmd:…" # any runner
//
// Real model calls — never run in CI. Restores every touched file whether
// heals succeed, fail, crash, or the run is interrupted.

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import cypress from 'cypress';
import { mutationGuard, runCli, startServer } from './lib/harness.mjs';

const modelIdx = process.argv.indexOf('--model');
const MODEL = modelIdx === -1 ? 'claude' : process.argv[modelIdx + 1];

const mutations = JSON.parse(readFileSync('bench/mutations.json', 'utf8'));
if (mutations.length === 0) {
  console.error('bench/mutations.json is empty — a 0/0 benchmark proves nothing');
  process.exit(1);
}
const results = [];
const guard = mutationGuard();

const server = await startServer('demo', 4173);

try {
  for (const mutation of mutations) {
    console.log(`\n═══ ${mutation.id} (${mutation.style}) — expect ${mutation.expect} ═══`);
    const started = Date.now();
    let outcome = 'error';
    let attempts = 0;
    let tier;

    try {
      guard.save(mutation.spec);
      for (const change of mutation.changes) {
        guard.save(change.file);
        const current = readFileSync(change.file, 'utf8');
        if (!current.includes(change.before)) throw new Error(`mutation anchor missing in ${change.file}`);
        writeFileSync(change.file, current.replaceAll(change.before, change.after));
      }

      rmSync('.goldseam', { recursive: true, force: true });
      const red = await cypress.run({ quiet: true, config: { specPattern: mutation.spec } });
      // A failed-to-launch result has no totals — that's an infra error, not
      // a benchmark verdict (mislabeling it false-green would poison the
      // launch table).
      if (red.totalFailed === undefined) throw new Error(`cypress failed to launch: ${red.message ?? 'unknown'}`);
      if (red.totalFailed === 0) throw new Error('mutation did not break the spec');
      console.log(`  break: ${red.totalFailed} test(s) failing`);

      const heal = runCli(['heal', '--model', MODEL, '--no-cache']);
      process.stdout.write(heal.stdout.split('\n').map((l) => `  ${l}`).join('\n'));

      const healFiles = existsSync('.goldseam/heals') ? readdirSync('.goldseam/heals') : [];
      const verdicts = healFiles.map((f) => JSON.parse(readFileSync(`.goldseam/heals/${f}`, 'utf8')));
      attempts = verdicts.reduce((sum, v) => sum + v.attempts.length, 0);
      // Several captures per mutation can heal at different tiers.
      tier = [...new Set(verdicts.map((v) => v.tier).filter(Boolean))].join('/') || undefined;

      if (verdicts.length > 0 && verdicts.every((v) => v.verdict === 'healed')) {
        // Trust, then verify: the healed spec must be green against the mutated app.
        const green = await cypress.run({ quiet: true, config: { specPattern: mutation.spec } });
        if (green.totalFailed === undefined) throw new Error(`cypress failed to launch on verify: ${green.message ?? 'unknown'}`);
        outcome = green.totalFailed === 0 ? 'healed' : 'false-green';
      } else if (verdicts.some((v) => v.verdict === 'gave-up')) {
        outcome = 'gave-up';
      } else {
        outcome = 'failed';
      }
    } catch (e) {
      console.error(`  benchmark error: ${e.message}`);
    } finally {
      guard.restore();
    }

    const ok = outcome === mutation.expect;
    results.push({
      id: mutation.id,
      style: mutation.style,
      expect: mutation.expect,
      outcome,
      ok,
      attempts,
      tier,
      seconds: Math.round((Date.now() - started) / 1000),
    });
    console.log(`\n  → ${outcome} ${ok ? '(as expected ✔)' : `(EXPECTED ${mutation.expect} ✖)`}`);
  }
} finally {
  server.stop();
  rmSync('.goldseam', { recursive: true, force: true });
}

const score = results.filter((r) => r.ok).length;
const md = [
  `# goldseam benchmark`,
  '',
  `Model: \`${MODEL}\` · ${score}/${results.length} mutations matched expectation.`,
  '',
  '| Mutation | Selector style | Expected | Outcome | Attempts | Time |',
  '| --- | --- | --- | --- | --- | --- |',
  ...results.map(
    (r) =>
      `| ${r.id} | ${r.style} | ${r.expect} | ${r.ok ? '✔' : '✖'} ${r.outcome} | ${r.attempts} | ${r.seconds}s |`,
  ),
  '',
].join('\n');

writeFileSync('bench/latest-results.md', md);
writeFileSync('bench/latest-results.json', JSON.stringify({ model: MODEL, results }, null, 2));
console.log(`\n${md}`);
process.exit(score === results.length ? 0 : 1);
