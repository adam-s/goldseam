#!/usr/bin/env node
// `goldseam` CLI — the after-the-run half of the pipeline. Stages are
// config, verdicts are artifacts.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';

import { dirname, join } from 'path';
import { DEFAULT_HEAL_OPTIONS, healArtifactFile } from '../heal/engine';
import { resolveRunner } from '../heal/runners';
import { HealOptions } from '../heal/types';
import { SUPPORT_SNIPPET, wireConfigSource, wireSupportSource } from './init';
import { renderEntry } from './eject';
import { ReportEntry, buildReport, renderMarkdown } from './report';
import { FailureArtifact } from '../shared/types';
import { HealArtifact } from '../heal/types';
import { loadGoldseamConfig, resolveHealModel } from '../shared/config';

const USAGE = `goldseam — self-healing for the Cypress suites you already have

Usage:
  goldseam init             wire this Cypress project (support + config), idempotent
  goldseam heal [options]   read failure artifacts, propose + verify selector fixes
  goldseam report [options] per-test summary of captures + heals
  goldseam eject            render cached cy.goldseam translations as plain Cypress code
  goldseam pr               open PR(s) from verified heals            (M5, not yet)

Config: an optional goldseam.config.mjs at the project root supplies
defaults for both this CLI and cy.goldseam(); every flag below overrides it.

heal options:
  --model <spec>          claude | claude:<model> | ollama:<model> | openai:<model> | cmd:<exe>
                          (default: GOLDSEAM_MODEL env, then config, then claude → Sonnet)
  --dry-run               propose + validate only; touch nothing, skip reruns
  --only <substr>         heal only captures whose spec path or title matches
  --skip <substr>         skip captures whose spec path or title matches
  --no-cache              skip heal memory (.goldseam/heal-cache.json); always ask the model
  --oracle-file <path>    known-good aria identities for the oracle rung
                          (default: .goldseam/oracle.json; rung skips if absent)
  --config-file <path>    Cypress config for reruns (monorepo per-app configs)
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
  const value = i === -1 ? undefined : process.argv[i + 1];
  return value?.startsWith('--') ? undefined : value;
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
  // VS Code terminals export ELECTRON_RUN_AS_NODE=1, which breaks the
  // Cypress binary the rerun rungs spawn ("Could not find Cypress test
  // run results") — strip it for the heal path only (report/eject spawn
  // nothing; an exotic cmd: Electron runner is the documented tradeoff).
  delete process.env.ELECTRON_RUN_AS_NODE;
  const projectRoot = process.cwd();
  // goldseam.config.mjs (if any) supplies defaults BELOW every flag: a
  // flag always wins, the config fills what the flag left unset.
  const cfg = await loadGoldseamConfig(projectRoot);
  const cacheDisabled = process.argv.includes('--no-cache') || cfg.heal?.cache === false;
  const failuresDir =
    arg('--failures-dir') ?? cfg.heal?.failuresDir ?? join('.goldseam', 'failures');
  const options: HealOptions = {
    ...DEFAULT_HEAL_OPTIONS,
    stages:
      arg('--stages')?.split(',').map((s) => s.trim()) ??
      cfg.heal?.stages ??
      DEFAULT_HEAL_OPTIONS.stages,
    maxAttempts: Number(arg('--max-attempts') ?? cfg.heal?.maxAttempts ?? DEFAULT_HEAL_OPTIONS.maxAttempts),
    minConfidence: Number(arg('--min-confidence') ?? cfg.heal?.minConfidence ?? DEFAULT_HEAL_OPTIONS.minConfidence),
    dryRun: process.argv.includes('--dry-run'),
    projectRoot,
    healsDir: arg('--heals-dir') ?? cfg.heal?.healsDir ?? join('.goldseam', 'heals'),
    cacheFile: cacheDisabled ? null : join('.goldseam', 'heal-cache.json'),
    oracleFile: arg('--oracle-file') ?? cfg.heal?.oracleFile ?? join('.goldseam', 'oracle.json'),
    configFile: arg('--config-file') ?? cfg.heal?.configFile,
  };
  const runner = resolveRunner(resolveHealModel(arg('--model'), process.env, cfg));

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
  // Several tests in one spec can break together; each heal's rerun must
  // tolerate the OTHER still-pending breaks (and nothing else).
  const pending = new Map(
    selected.map((file) => {
      const a = JSON.parse(readFileSync(join(failuresDir, file), 'utf8')) as FailureArtifact;
      return [file, { specPath: a.specPath, title: a.title }];
    }),
  );
  let healed = 0;
  for (const file of selected) {
    const me = pending.get(file)!;
    const knownBrokenTitles = [...pending.entries()]
      .filter(([f, p]) => f !== file && p.specPath === me.specPath)
      .map(([, p]) => p.title);
    // A capture can vanish mid-batch (a concurrent Cypress session
    // rewriting .goldseam) — skip it, never abandon the rest of the batch.
    if (!existsSync(join(failuresDir, file))) {
      console.log(`∅ [skipped] ${me.title} — capture disappeared during the run (concurrent Cypress session?)`);
      continue;
    }
    const result = await healArtifactFile(join(failuresDir, file), runner, { ...options, knownBrokenTitles });
    if (result.verdict === 'healed') pending.delete(file);
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
      for (const flag of result.reviewFlags ?? []) console.log(`    ⚠ ${flag}`);
    }
  }
  console.log(`\n${healed}/${selected.length} healed; heal artifacts in ${options.healsDir}`);
  return 0;
}

async function report(): Promise<number> {
  const cfg = await loadGoldseamConfig(process.cwd());
  const failuresDir = arg('--failures-dir') ?? cfg.heal?.failuresDir ?? join('.goldseam', 'failures');
  const healsDir = arg('--heals-dir') ?? cfg.heal?.healsDir ?? join('.goldseam', 'heals');
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

async function eject(): Promise<number> {
  const cfg = await loadGoldseamConfig(process.cwd());
  const dir = arg('--prompts-dir') ?? cfg.author?.promptsDir ?? '.goldseam-prompts';
  if (!existsSync(dir)) {
    console.log(`goldseam eject: no translations in ${dir}.`);
    return 0;
  }
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const entry = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    console.log(`\n// ─── ${f} ───`);
    console.log(renderEntry(entry.steps, entry.commands));
  }
  console.log('\n// Paste into your spec to replace the cy.goldseam(...) call.');
  console.log('// Ejected code keeps healing — it goes through the normal capture → heal pipeline.');
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
    report().then(
      (code) => process.exit(code),
      (err) => {
        console.error(`goldseam report: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      },
    );
    break;
  case 'eject':
    eject().then(
      (code) => process.exit(code),
      (err) => {
        console.error(`goldseam eject: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      },
    );
    break;
  case 'pr':
    console.error(`goldseam ${command}: not implemented yet (see docs/plan.md, M5)`);
    process.exit(1);
    break;
  default:
    console.log(USAGE);
    process.exit(command === undefined || command === 'help' ? 0 : 1);
}
