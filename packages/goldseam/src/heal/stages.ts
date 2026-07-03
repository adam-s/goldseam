// The Phase-1 ladder rungs. Each stage reads the context and returns a
// verdict artifact; any failing rung stops the attempt. Later rungs
// (oracle, mutation-guard, adversary…) register here without touching the
// engine.

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCacheEdit, loadCache, lookup } from './cache';
import { buildRepairPrompt } from './prompt';
import { parseRepairReply, ReplyParseError } from './parse';
import { EditRejected, validateEdits } from './validate';
import { HealContext, HealStage, StageVerdict } from './types';

const verdict = (
  stage: string,
  v: StageVerdict['verdict'],
  evidence: string,
  started: number,
): StageVerdict => ({ stage, verdict: v, evidence, durationMs: Date.now() - started });

export const proposeStage: HealStage = {
  name: 'propose',
  async run(ctx: HealContext): Promise<StageVerdict> {
    const started = Date.now();
    const { artifact, options } = ctx;

    // Give-up signals are checked before any model call.
    if (artifact.url === 'about:blank') {
      return verdict('propose', 'gave-up', 'url is about:blank — the visit never loaded', started);
    }
    if (artifact.captureError) {
      return verdict('propose', 'gave-up', `capture degraded: ${artifact.captureError}`, started);
    }

    const specAbs = join(options.projectRoot, artifact.specPath);
    const specSource = readFileSync(specAbs, 'utf8');

    // Cache tier: a previously verified heal for this exact broken
    // selector proposes with zero model calls. Tried once per heal; the
    // ladder still verifies it like any other proposal.
    if (options.cacheFile && !ctx.cacheTried && artifact.failedSelector) {
      ctx.cacheTried = true;
      const entry = lookup(loadCache(options.cacheFile), artifact.failedSelector);
      const edit = entry && buildCacheEdit(entry, artifact.specPath, specSource);
      if (entry && edit) {
        // The cache file is repo content — treat it as untrusted like any
        // model reply and run the full validator (red-team finding: a
        // poisoned replacement must not skip scrutiny).
        try {
          validateEdits({ edits: [edit], confidence: 1 }, artifact.specPath, specSource);
          ctx.proposal = {
            edits: [edit],
            confidence: 1,
            reasoning: `heal memory: "${entry.failedSelector}" → "${entry.replacement}" (verified ${entry.healedAt}, ${entry.specPath})`,
          };
          ctx.proposalSource = 'cache';
          return verdict(
            'propose',
            'pass',
            `cache hit: "${entry.failedSelector}" → "${entry.replacement}" (no model call)`,
            started,
          );
        } catch {
          // Invalid cache entry ⇒ miss; fall through to the model.
        }
      }
    }

    const prompt = buildRepairPrompt({
      artifact,
      specSource,
      selectorPriority: options.selectorPriority,
      feedback: ctx.feedback,
    });

    let raw: string;
    try {
      raw = await ctx.runner.repair(prompt);
    } catch (e) {
      return verdict('propose', 'fail', `runner error: ${e instanceof Error ? e.message : e}`, started);
    }

    try {
      const reply = parseRepairReply(raw);
      if (reply.giveUp) {
        return verdict('propose', 'gave-up', `model gave up: ${reply.giveUp.reason}`, started);
      }
      if ((reply.confidence ?? 0) < options.minConfidence) {
        return verdict(
          'propose',
          'gave-up',
          `confidence ${reply.confidence} below floor ${options.minConfidence}`,
          started,
        );
      }
      const edits = validateEdits(reply, artifact.specPath, specSource);
      ctx.proposal = { ...reply, edits };
      ctx.proposalSource = 'model';
      const summary = edits
        .map((e) => `"${e.oldString.trim()}" → "${e.newString.trim()}"`)
        .join('; ');
      return verdict(
        'propose',
        'pass',
        `${edits.length} edit(s): ${summary} (confidence ${reply.confidence})`,
        started,
      );
    } catch (e) {
      if (e instanceof ReplyParseError || e instanceof EditRejected) {
        return verdict('propose', 'fail', e.message, started);
      }
      throw e;
    }
  },
};

// The rerun rungs drive Cypress through the Module API from the target
// project. `cypress` is a peer dependency resolved from the project.
interface CypressRunResult {
  totalFailed?: number;
  totalTests?: number;
  status?: string;
  message?: string;
  runs?: Array<{ tests?: Array<{ title: string[]; state: string }> }>;
}
type CypressModule = { run(opts: Record<string, unknown>): Promise<CypressRunResult> };

function loadCypress(projectRoot: string): CypressModule {
  const req = createRequire(join(projectRoot, 'noop.js'));
  return req('cypress') as CypressModule;
}

/**
 * Test-level rerun verdict (pure; unit-tested). Multiple tests in one spec
 * can break together, so a rung must judge THE healed test, not the run:
 * - rerun-test: the healed test ran and passed.
 * - rerun-spec: the healed test passed AND every remaining failure is a
 *   known pending break (another capture awaiting its own heal).
 */
export function rerunVerdictFor(
  stageName: string,
  result: CypressRunResult,
  healedTitle: string,
  knownBrokenTitles: string[],
): { pass: boolean; evidence: string } {
  const tests = result.runs?.flatMap((r) => r.tests ?? []) ?? [];
  const byTitle = (t: { title: string[] }) => t.title.join(' ');
  const healed = tests.find((t) => byTitle(t) === healedTitle);
  if (!healed) {
    return { pass: false, evidence: `healed test "${healedTitle}" did not run (${tests.length} ran)` };
  }
  if (healed.state !== 'passed') {
    return { pass: false, evidence: `healed test still ${healed.state} after applying the heal` };
  }
  const unexpected = tests
    .filter((t) => t.state === 'failed')
    .map(byTitle)
    .filter((title) => !knownBrokenTitles.includes(title));
  if (stageName === 'rerun-spec' && unexpected.length > 0) {
    return { pass: false, evidence: `heal broke other test(s): ${unexpected.join('; ')}` };
  }
  const known = tests.filter((t) => t.state === 'failed').length;
  return {
    pass: true,
    evidence: `healed test passed${known > 0 ? ` (${known} other failure(s) are known pending breaks)` : ''}`,
  };
}

async function rerun(ctx: HealContext, stageName: string, grepTitle?: string): Promise<StageVerdict> {
  const started = Date.now();
  if (ctx.options.dryRun) {
    return verdict(stageName, 'pass', 'dry-run: rerun skipped', started);
  }
  ctx.apply();
  const cypress = loadCypress(ctx.options.projectRoot);
  const result = await cypress.run({
    quiet: true,
    config: { specPattern: ctx.artifact.specPath },
    // Single-test isolation via @cypress/grep when the project has it
    // registered; without it the env is inert and the whole spec runs —
    // the verdict below is test-level either way, grep only buys speed.
    ...(grepTitle ? { env: { grep: grepTitle } } : {}),
  });
  if (result.status === 'failed') {
    return verdict(stageName, 'fail', `cypress could not run: ${result.message}`, started);
  }
  const { pass, evidence } = rerunVerdictFor(
    stageName,
    result,
    ctx.artifact.title,
    ctx.options.knownBrokenTitles ?? [],
  );
  return verdict(stageName, pass ? 'pass' : 'fail', evidence, started);
}

export const rerunTestStage: HealStage = {
  name: 'rerun-test',
  run: (ctx) => rerun(ctx, 'rerun-test', ctx.artifact.title),
};

export const rerunSpecStage: HealStage = {
  name: 'rerun-spec',
  run: (ctx) => rerun(ctx, 'rerun-spec'),
};

export const STAGES: Record<string, HealStage> = {
  propose: proposeStage,
  'rerun-test': rerunTestStage,
  'rerun-spec': rerunSpecStage,
};
