// The benchmark: apply each mutation from bench/mutations.json to the
// demo app, capture the breakage, run `goldseam heal`, and score the
// outcome against the mutation's expectation. Heal-rate by selector style
// is the launch table — data no incumbent publishes.
//
//   node scripts/benchmark.mjs                 # model: claude (Sonnet)
//   node scripts/benchmark.mjs --model "cmd:…" # any runner
//
// Real model calls — never run in CI. Restores every touched file whether
// heals succeed, fail, or crash.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import cypress from 'cypress';

delete process.env.ELECTRON_RUN_AS_NODE;

const CLI = 'packages/goldseam/dist/cli/index.js';
const modelIdx = process.argv.indexOf('--model');
const MODEL = modelIdx === -1 ? 'claude' : process.argv[modelIdx + 1];

const mutations = JSON.parse(readFileSync('bench/mutations.json', 'utf8'));
const results = [];

async function waitForServer(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('demo server never became ready');
}

const server = spawn('npx', ['http-server', 'demo', '-p', '4173', '-c-1', '--silent'], {
  stdio: 'ignore',
});

try {
  await waitForServer('http://localhost:4173/');

  for (const mutation of mutations) {
    console.log(`\n═══ ${mutation.id} (${mutation.style}) — expect ${mutation.expect} ═══`);
    const saved = new Map();
    const specBefore = readFileSync(mutation.spec, 'utf8');
    const started = Date.now();
    let outcome = 'error';
    let attempts = 0;
    let tier;

    try {
      for (const change of mutation.changes) {
        if (!saved.has(change.file)) saved.set(change.file, readFileSync(change.file, 'utf8'));
        const current = readFileSync(change.file, 'utf8');
        if (!current.includes(change.before)) throw new Error(`mutation anchor missing in ${change.file}`);
        writeFileSync(change.file, current.replaceAll(change.before, change.after));
      }

      rmSync('.goldseam', { recursive: true, force: true });
      const red = await cypress.run({ quiet: true, config: { specPattern: mutation.spec } });
      if ((red.totalFailed ?? 0) === 0) throw new Error('mutation did not break the spec');
      console.log(`  break: ${red.totalFailed} test(s) failing`);

      const heal = spawnSync('node', [CLI, 'heal', '--model', MODEL, '--no-cache'], {
        encoding: 'utf8',
      });
      process.stdout.write(heal.stdout.split('\n').map((l) => `  ${l}`).join('\n'));

      const healFiles = existsSync('.goldseam/heals') ? readdirSync('.goldseam/heals') : [];
      const verdicts = healFiles.map((f) => JSON.parse(readFileSync(`.goldseam/heals/${f}`, 'utf8')));
      attempts = verdicts.reduce((sum, v) => sum + v.attempts.length, 0);
      tier = verdicts[0]?.tier;

      if (verdicts.length > 0 && verdicts.every((v) => v.verdict === 'healed')) {
        // Trust, then verify: the healed spec must be green against the mutated app.
        const green = await cypress.run({ quiet: true, config: { specPattern: mutation.spec } });
        outcome = (green.totalFailed ?? 1) === 0 ? 'healed' : 'false-green';
      } else if (verdicts.some((v) => v.verdict === 'gave-up')) {
        outcome = 'gave-up';
      } else {
        outcome = 'failed';
      }
    } catch (e) {
      console.error(`  benchmark error: ${e.message}`);
    } finally {
      for (const [file, content] of saved) writeFileSync(file, content);
      writeFileSync(mutation.spec, specBefore);
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
  server.kill();
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
