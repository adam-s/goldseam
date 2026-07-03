#!/usr/bin/env node
// `goldseam` CLI — the after-the-run half of the pipeline. Stages are
// config, verdicts are artifacts.

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { DEFAULT_HEAL_OPTIONS, healArtifactFile } from '../heal/engine';
import { resolveRunner } from '../heal/runners';
import { HealOptions } from '../heal/types';

const USAGE = `goldseam — self-healing for the Cypress suites you already have

Usage:
  goldseam heal [options]   read failure artifacts, propose + verify selector fixes
  goldseam pr               open PR(s) from verified heals            (M5, not yet)
  goldseam report           summarize captures + heals (md/json)      (M5, not yet)

heal options:
  --model <spec>          claude | claude:<model> | cmd:<executable>   (default: claude → Sonnet)
  --dry-run               propose + validate only; touch nothing, skip reruns
  --max-attempts <n>      hard attempt cap (default: ${DEFAULT_HEAL_OPTIONS.maxAttempts})
  --min-confidence <x>    give up below this confidence (default: ${DEFAULT_HEAL_OPTIONS.minConfidence})
  --stages <a,b,c>        ladder to run (default: ${DEFAULT_HEAL_OPTIONS.stages.join(',')})
  --failures-dir <dir>    capture artifacts (default: .goldseam/failures)
  --heals-dir <dir>       heal artifacts    (default: .goldseam/heals)

The app under test must be reachable (same requirement as \`cypress run\`)
for the rerun stages.
`;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function heal(): Promise<number> {
  const projectRoot = process.cwd();
  const failuresDir = arg('--failures-dir') ?? join('.goldseam', 'failures');
  const options: HealOptions = {
    ...DEFAULT_HEAL_OPTIONS,
    stages: arg('--stages')?.split(',').map((s) => s.trim()) ?? DEFAULT_HEAL_OPTIONS.stages,
    maxAttempts: Number(arg('--max-attempts') ?? DEFAULT_HEAL_OPTIONS.maxAttempts),
    minConfidence: Number(arg('--min-confidence') ?? DEFAULT_HEAL_OPTIONS.minConfidence),
    dryRun: process.argv.includes('--dry-run'),
    projectRoot,
    healsDir: arg('--heals-dir') ?? join('.goldseam', 'heals'),
  };
  const runner = resolveRunner(arg('--model') ?? 'claude');

  if (!existsSync(failuresDir)) {
    console.log(`goldseam heal: no captures found in ${failuresDir} — nothing to do.`);
    return 0;
  }
  const artifacts = readdirSync(failuresDir).filter((f) => f.endsWith('.json'));
  if (artifacts.length === 0) {
    console.log(`goldseam heal: no captures found in ${failuresDir} — nothing to do.`);
    return 0;
  }

  console.log(`goldseam heal: ${artifacts.length} capture(s), model ${runner.id}${options.dryRun ? ', dry-run' : ''}\n`);
  let healed = 0;
  for (const file of artifacts) {
    const result = await healArtifactFile(join(failuresDir, file), runner, options);
    const mark = { healed: '✔', 'gave-up': '∅', failed: '✖' }[result.verdict];
    console.log(`${mark} [${result.verdict}] ${result.title}`);
    for (const attempt of result.attempts) {
      for (const rung of attempt.ladder) {
        console.log(`    attempt ${attempt.attempt} · ${rung.stage}: ${rung.verdict} — ${rung.evidence}`);
      }
    }
    if (result.verdict === 'healed') {
      healed++;
      console.log(`    edit applied to ${result.specPath}${options.dryRun ? ' (dry-run: not written)' : ''}`);
    }
  }
  console.log(`\n${healed}/${artifacts.length} healed; heal artifacts in ${options.healsDir}`);
  return 0;
}

const command = process.argv[2];
switch (command) {
  case 'heal':
    heal().then(
      (code) => process.exit(code),
      (err) => {
        console.error(`goldseam heal: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      },
    );
    break;
  case 'pr':
  case 'report':
    console.error(`goldseam ${command}: not implemented yet (see docs/plan.md, M5)`);
    process.exit(1);
    break;
  default:
    console.log(USAGE);
    process.exit(command === undefined || command === 'help' ? 0 : 1);
}
