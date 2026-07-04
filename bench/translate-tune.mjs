// Recursive eval-driven prompt tuning — the intercept2 loop, goldseam-
// shaped. Each iteration: run the eval, and if cases fail, ask the model
// to revise the RULES block (packages/goldseam/src/plugin/
// translate-rules.ts) under two disciplines lifted from intercept2's
// instruction-tuning skill:
//   1. GENERALIZE — a rule naming one case/page is a hack; revisions
//      must state principles.
//   2. REGRESSIONS need proof — a candidate rules block is kept only if
//      it scores >= the incumbent on a FULL re-run; sampling noise is
//      handled by requiring the stop condition (perfect score) twice in
//      a row before declaring convergence.
// Local-only, real model calls (~21/iteration). Never CI.

import { execSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const MAX_ITERS = Number(process.env.TUNE_ITERS ?? 4);
const RULES_FILE = 'packages/goldseam/src/plugin/translate-rules.ts';
const LOG = 'bench/tuning-log.md';

const runEval = () => {
  spawnSync('node', ['bench/translate-eval.mjs', '--model', 'claude:sonnet'], { encoding: 'utf8' });
  return JSON.parse(readFileSync('bench/translate-results.json', 'utf8'));
};
const score = (r) => Number(r.score.split('/')[0]);
const rebuild = () => execSync('npm run build:packages', { stdio: 'pipe' });

let best = readFileSync(RULES_FILE, 'utf8');
let perfectStreak = 0;
appendFileSync(LOG, `\n## Tuning run ${new Date().toISOString()}\n`);

for (let iter = 1; iter <= MAX_ITERS; iter++) {
  const result = runEval();
  const failures = result.results.filter((r) => !r.pass);
  appendFileSync(LOG, `- iter ${iter}: ${result.score} (must-refuse ${result.mustRefuse})${failures.length ? ` — failing: ${failures.map((f) => f.name).join(', ')}` : ''}\n`);
  console.log(`iter ${iter}: ${result.score}${failures.length ? ` failing: ${failures.map((f) => f.name).join(', ')}` : ''}`);

  if (failures.length === 0) {
    perfectStreak++;
    if (perfectStreak >= 2) {
      appendFileSync(LOG, `- converged: perfect twice in a row\n`);
      console.log('converged: perfect twice in a row');
      process.exit(0);
    }
    continue; // one perfect run could be luck — confirm
  }
  perfectStreak = 0;

  const current = readFileSync(RULES_FILE, 'utf8');
  const prompt = `You maintain the RULES block of a prompt that translates plain-English test steps into constrained JSON commands. An automated eval just failed the cases below. Revise the rules to fix the FAILURE CLASSES without breaking anything else.

Discipline (non-negotiable):
- Rules must be GENERAL principles. Never mention a specific case, page, or fixture.
- Keep every existing rule's intent unless a failure proves it wrong; prefer sharpening over adding; the block must stay compact.
- If a failure looks like one-off sampling noise rather than a rules gap, leave the rules unchanged (reply with the file exactly as given).

Reply with ONLY the complete new contents of the TypeScript file, no fences, no prose.

## Current file
${current}

## Failing cases
${failures.map((f) => `### ${f.name}\nsteps: ${JSON.stringify(JSON.parse(readFileSync(`bench/translate-cases/${f.name}/case.json`, 'utf8')).steps)}\ngrader: ${f.failures.join('; ')}\nmodel output: ${JSON.stringify(f.outcome).slice(0, 600)}\n`).join('\n')}`;

  const revision = spawnSync('claude', ['-p', '--model', 'sonnet'], { input: prompt, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const candidate = (revision.stdout ?? '').trim();
  if (!candidate.includes('export const TRANSLATE_RULES')) {
    appendFileSync(LOG, `- iter ${iter}: revision malformed — skipped\n`);
    continue;
  }
  if (candidate.trim() === current.trim()) {
    appendFileSync(LOG, `- iter ${iter}: model judged failures as noise — rules unchanged\n`);
    continue;
  }
  writeFileSync(RULES_FILE, candidate.endsWith('\n') ? candidate : candidate + '\n');
  try {
    rebuild();
  } catch {
    appendFileSync(LOG, `- iter ${iter}: candidate did not compile — reverted\n`);
    writeFileSync(RULES_FILE, best);
    rebuild();
    continue;
  }
  const retest = runEval();
  if (score(retest) >= score(result) && retest.mustRefuse === result.mustRefuse) {
    appendFileSync(LOG, `- iter ${iter}: candidate kept (${result.score} → ${retest.score})\n`);
    best = candidate;
  } else {
    appendFileSync(LOG, `- iter ${iter}: candidate reverted (${result.score} → ${retest.score})\n`);
    writeFileSync(RULES_FILE, best);
    rebuild();
  }
}
console.log(`done after ${MAX_ITERS} iterations — see ${LOG}`);
