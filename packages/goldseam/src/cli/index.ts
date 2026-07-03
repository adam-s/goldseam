#!/usr/bin/env node
// `goldseam` CLI — the after-the-run half of the pipeline. Stages are
// config, verdicts are artifacts.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { DEFAULT_HEAL_OPTIONS, healArtifactFile } from '../heal/engine';
import { resolveRunner } from '../heal/runners';
import { HealOptions } from '../heal/types';
import { SUPPORT_SNIPPET, wireConfigSource, wireSupportSource } from './init';
import { ReportEntry, buildReport, renderMarkdown } from './report';
import { FailureArtifact } from '../shared/types';
import { HealArtifact } from '../heal/types';

const USAGE = `goldseam — self-healing for the Cypress suites you already have

Usage:
  goldseam init             wire this Cypress project (support + config), idempotent
  goldseam heal [options]   read failure artifacts, propose + verify selector fixes
  goldseam report [options] per-test summary of captures + heals
  goldseam pr               open PR(s) from verified heals            (M5, not yet)

heal options:
  --model <spec>          claude | claude:<model> | cmd:<executable>   (default: claude → Sonnet)
  --dry-run               propose + validate only; touch nothing, skip reruns
  --only <substr>         heal only captures whose spec path or title matches
  --skip <substr>         skip captures whose spec path or title matches
  --max-attempts <n>      hard attempt cap (default: ${DEFAULT_HEAL_OPTIONS.maxAttempts})
  --min-confidence <x>    give up below this confidence (default: ${DEFAULT_HEAL_OPTIONS.minConfidence})
  --stages <a,b,c>        ladder to run (default: ${DEFAULT_HEAL_OPTIONS.stages.join(',')})
  --failures-dir <dir>    capture artifacts (default: .goldseam/failures)
  --heals-dir <dir>       heal artifacts    (default: .goldseam/heals)

report options:
  --format <md|json>      output format (default: md)
  --out <file>            write to a file instead of stdout
  --failures-dir/--heals-dir as above

The app under test must be reachable (same requirement as \`cypress run\`)
for the rerun stages.
`;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function init(): number {
  const configPath = ['cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs', 'cypress.config.cjs'].find(
    (p) => existsSync(p),
  );
  if (!configPath) {
    console.error('goldseam init: no cypress.config.{ts,js,mjs,cjs} here — run inside a Cypress project.');
    return 1;
  }

  const config = wireConfigSource(readFileSync(configPath, 'utf8'));
  if (config.changed) {
    writeFileSync(configPath, config.source);
    console.log(`✔ ${configPath}: wired goldseam(on, config) into setupNodeEvents`);
  } else if (config.instructions) {
    console.log(`∅ ${configPath}: couldn't find setupNodeEvents — add this yourself:\n\n${config.instructions}\n`);
  } else {
    console.log(`✔ ${configPath}: already wired`);
  }

  const isTs = configPath.endsWith('.ts');
  const supportPath = [`cypress/support/e2e.${isTs ? 'ts' : 'js'}`, 'cypress/support/e2e.ts', 'cypress/support/e2e.js'].find(
    (p) => existsSync(p),
  );
  if (supportPath) {
    const support = wireSupportSource(readFileSync(supportPath, 'utf8'));
    if (support.changed) writeFileSync(supportPath, support.source);
    console.log(`✔ ${supportPath}: ${support.changed ? 'added the register import' : 'already wired'}`);
  } else {
    const created = `cypress/support/e2e.${isTs ? 'ts' : 'js'}`;
    mkdirSync(dirname(created), { recursive: true });
    writeFileSync(created, `${SUPPORT_SNIPPET}\n`);
    console.log(`✔ ${created}: created with the register import`);
  }

  console.log('\nDone. Failures now write capture artifacts to .goldseam/failures/;');
  console.log('heal them with: npx goldseam heal');
  return 0;
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

  const only = arg('--only');
  const skip = arg('--skip');
  const selected = artifacts.filter((file) => {
    if (!only && !skip) return true;
    const a = JSON.parse(readFileSync(join(failuresDir, file), 'utf8')) as FailureArtifact;
    const haystack = `${a.specPath} ${a.title}`;
    if (only && !haystack.includes(only)) return false;
    if (skip && haystack.includes(skip)) return false;
    return true;
  });
  if (selected.length < artifacts.length) {
    console.log(`goldseam heal: ${artifacts.length - selected.length} capture(s) filtered out by --only/--skip`);
  }

  console.log(`goldseam heal: ${selected.length} capture(s), model ${runner.id}${options.dryRun ? ', dry-run' : ''}\n`);
  let healed = 0;
  for (const file of selected) {
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
  console.log(`\n${healed}/${selected.length} healed; heal artifacts in ${options.healsDir}`);
  return 0;
}

function report(): number {
  const failuresDir = arg('--failures-dir') ?? join('.goldseam', 'failures');
  const healsDir = arg('--heals-dir') ?? join('.goldseam', 'heals');
  const format = arg('--format') ?? 'md';

  const captureFiles = existsSync(failuresDir)
    ? readdirSync(failuresDir).filter((f) => f.endsWith('.json'))
    : [];
  const healsByRef = new Map<string, HealArtifact>();
  if (existsSync(healsDir)) {
    for (const f of readdirSync(healsDir).filter((f) => f.endsWith('-heal.json'))) {
      const heal = JSON.parse(readFileSync(join(healsDir, f), 'utf8')) as HealArtifact;
      healsByRef.set(heal.captureRef, heal);
    }
  }
  const entries: ReportEntry[] = captureFiles.map((captureFile) => ({
    captureFile,
    capture: JSON.parse(readFileSync(join(failuresDir, captureFile), 'utf8')) as FailureArtifact,
    heal: healsByRef.get(captureFile),
  }));

  const built = buildReport(entries);
  const output = format === 'json' ? `${JSON.stringify(built, null, 2)}\n` : renderMarkdown(built);
  const out = arg('--out');
  if (out) {
    writeFileSync(out, output);
    console.log(`goldseam report: wrote ${out} (${built.totals.captures} capture(s))`);
  } else {
    process.stdout.write(output);
  }
  return 0;
}

const command = process.argv[2];
switch (command) {
  case 'init':
    process.exit(init());
    break;
  case 'heal':
    heal().then(
      (code) => process.exit(code),
      (err) => {
        console.error(`goldseam heal: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      },
    );
    break;
  case 'report':
    process.exit(report());
    break;
  case 'pr':
    console.error(`goldseam ${command}: not implemented yet (see docs/plan.md, M5)`);
    process.exit(1);
    break;
  default:
    console.log(USAGE);
    process.exit(command === undefined || command === 'help' ? 0 : 1);
}
