// "The suite must bite" — deterministic mutation smoke for CI, distilled
// from the mutation-red-team skill: apply a known regression to
// production source, run the unit suite, REQUIRE failure, revert. A
// mutation that survives fails this script — the suite could not tell
// broken from working, which is the one thing a trust-first heal
// pipeline cannot allow. (The full agent-driven mutation red-team stays
// local; this is its always-on CI shadow.)

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const MUTATIONS = [
  {
    name: 'redaction neutered (never-leak invariant)',
    file: 'packages/goldseam/src/support/redact.ts',
    find: 'export function maskText(text: string): string {',
    replace: 'export function maskText(text: string): string {\n  return text;',
  },
  {
    // The two revert CALL SITES are deliberately redundant (removing
    // either alone is an equivalent mutant) — so probe the mechanism:
    // a revert() that does nothing must fail the suite.
    name: 'revert() neutered (revert invariant)',
    file: 'packages/goldseam/src/heal/engine.ts',
    find: '      if (!applied) return;\n      writeFileSync(specAbs, originalSpec);',
    replace: '      if (applied) return;\n      writeFileSync(specAbs, originalSpec);',
  },
  {
    name: 'assertion guard dropped (heals-never-weaken invariant)',
    file: 'packages/goldseam/src/heal/validate.ts',
    find: "  if (call && ASSERTION_CALLS.has(call)) {",
    replace: '  if (false) {',
  },
  {
    name: 'hook heals judged by test title again (hook-verdict regression)',
    file: 'packages/goldseam/src/heal/stages.ts',
    find: '  if (HOOK_TITLE_RE.test(healedTitle)) {',
    replace: '  if (false) {',
  },
];

let failures = 0;
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, 'utf8');
  if (!original.includes(m.find)) {
    console.error(`✖ ${m.name}: anchor not found in ${m.file} — mutation is stale, update it`);
    failures++;
    continue;
  }
  writeFileSync(m.file, original.replace(m.find, m.replace));
  try {
    execSync('npm run build:packages', { stdio: 'pipe' });
    const run = spawnSync('npm', ['run', 'test:unit'], { encoding: 'utf8' });
    if (run.status === 0) {
      console.error(`✖ SURVIVED: ${m.name} — the suite passed with broken code`);
      failures++;
    } else {
      console.log(`✔ caught: ${m.name}`);
    }
  } finally {
    writeFileSync(m.file, original);
  }
}
execSync('npm run build:packages', { stdio: 'pipe' }); // leave dist honest

if (failures > 0) {
  console.error(`\nSUITE-BITES FAILED: ${failures} mutation(s) survived or went stale`);
  process.exit(1);
}
console.log('\nSUITE-BITES PASSED: every mutation was caught');
