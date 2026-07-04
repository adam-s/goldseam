// The heal engine: run the configured ladder over one capture artifact,
// retry propose with feedback under a hard attempt cap, and record every
// verdict — healed, failed, or gave-up — as a heal artifact.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { FailureArtifact } from '../shared/types';
import { deriveReplacement, saveEntry } from './cache';
import { reviewFlagsFor } from './resolve';
import { STAGES } from './stages';
import {
  HEAL_SCHEMA_VERSION,
  HealArtifact,
  HealAttempt,
  HealContext,
  HealOptions,
  RepairRunner,
} from './types';

export const DEFAULT_HEAL_OPTIONS: Omit<HealOptions, 'projectRoot' | 'healsDir' | 'cacheFile'> = {
  stages: ['triage', 'propose', 'resolve', 'rerun-test', 'rerun-spec'],
  maxAttempts: 3,
  minConfidence: 0.5,
  selectorPriority: ['data-cy', 'data-testid', 'role', 'text', 'css'],
  dryRun: false,
};

export async function healArtifactFile(
  artifactPath: string,
  runner: RepairRunner,
  options: HealOptions,
): Promise<HealArtifact> {
  const startedAt = Date.now();
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as FailureArtifact;
  // Artifacts are attacker-influenceable JSON; specPath must stay inside
  // the project (red-team finding: traversal → arbitrary file overwrite).
  const specAbs = resolve(options.projectRoot, artifact.specPath);
  if (!specAbs.startsWith(resolve(options.projectRoot) + sep)) {
    throw new Error(`capture names a spec outside the project: ${artifact.specPath}`);
  }
  const originalSpec = existsSync(specAbs) ? readFileSync(specAbs, 'utf8') : null;
  if (originalSpec === null) {
    throw new Error(`spec named by the capture does not exist: ${artifact.specPath}`);
  }

  const stages = options.stages.map((name) => {
    const stage = STAGES[name];
    if (!stage) throw new Error(`unknown heal stage "${name}" (available: ${Object.keys(STAGES).join(', ')})`);
    return stage;
  });

  let applied = false;
  const ctx: HealContext = {
    artifact,
    artifactPath,
    options,
    runner,
    apply() {
      const edits = ctx.proposal?.edits;
      if (!edits?.length || applied || options.dryRun) return;
      let source = originalSpec;
      // Replacement via callback: '$&'-style patterns in model output must
      // apply literally, not as replace() magic (red-team finding).
      for (const edit of edits) source = source.replace(edit.oldString, () => edit.newString);
      writeFileSync(specAbs, source);
      applied = true;
    },
    revert() {
      if (!applied) return;
      writeFileSync(specAbs, originalSpec);
      applied = false;
    },
  };

  const attempts: HealAttempt[] = [];
  let outcome: HealArtifact['verdict'] = 'failed';
  let siblingHealed = false;

  // A multi-edit heal earlier in this run may have already fixed this
  // capture's break (shared selector across tests). Verify — never assume:
  // the test must actually pass before we call it healed.
  if (!options.dryRun && artifact.failedSelector && !originalSpec.includes(artifact.failedSelector)) {
    try {
      const probe = await STAGES['rerun-test'].run(ctx); // no proposal ⇒ nothing applied
      attempts.push({ attempt: 0, ladder: [probe], source: undefined });
      if (probe.verdict === 'pass') {
        outcome = 'healed';
        siblingHealed = true;
      }
    } catch {
      // Probe unavailable (no cypress resolvable, etc.) — heal normally.
    }
  }

  for (let attempt = 1; !siblingHealed && attempt <= options.maxAttempts; attempt++) {
    const record: HealAttempt = { attempt, ladder: [] };
    attempts.push(record);
    ctx.proposal = undefined;
    ctx.proposalSource = undefined;

    let attemptFailed = false;
    for (const stage of stages) {
      const v = await stage.run(ctx);
      record.ladder.push(v);
      if (v.verdict === 'gave-up') {
        outcome = 'gave-up';
        break;
      }
      if (v.verdict === 'fail') {
        ctx.feedback = `Attempt ${attempt} was rejected at stage "${v.stage}": ${v.evidence}`;
        attemptFailed = true;
        break;
      }
    }
    record.proposal = ctx.proposal;
    record.source = ctx.proposalSource;

    if (outcome === 'gave-up') {
      ctx.revert();
      break;
    }
    if (!attemptFailed) {
      outcome = 'healed';
      ctx.apply(); // idempotent: ensures the edit is on disk even when no
      break; //       rerun stage ran (propose-only ladders, custom configs)
    }
    ctx.revert();
  }
  if (outcome !== 'healed') ctx.revert();

  const tier = siblingHealed ? 'sibling' : ctx.proposalSource === 'cache' ? 'cache' : 'model';
  const finalEdits = outcome === 'healed' ? ctx.proposal?.edits : undefined;

  // A verified MODEL heal feeds heal memory; cache heals just proved the
  // memory is still valid.
  // Only single-edit heals feed heal memory: one occurrence, one clean
  // selector mapping. Multi-edit heals are applied but not cached.
  if (options.cacheFile && finalEdits?.length === 1 && tier === 'model' && artifact.failedSelector) {
    const replacement = deriveReplacement(finalEdits[0], artifact.failedSelector);
    if (replacement) {
      saveEntry(options.cacheFile, {
        failedSelector: artifact.failedSelector,
        replacement,
        healedAt: new Date().toISOString(),
        specPath: artifact.specPath,
      });
    }
  }

  // Verified ≠ correct: a heal whose surviving assertions are weak passed
  // the rerun without proving it points at the intended element. Flag it
  // for the human — flags route attention, they never block.
  const reviewFlags = outcome === 'healed' && finalEdits ? reviewFlagsFor(originalSpec, finalEdits) : [];

  const heal: HealArtifact = {
    schemaVersion: HEAL_SCHEMA_VERSION,
    captureRef: basename(artifactPath),
    specPath: artifact.specPath,
    title: artifact.title,
    model: runner.id,
    tier,
    verdict: outcome,
    attempts,
    finalEdits,
    ...(reviewFlags.length > 0 ? { reviewFlags } : {}),
    confidence: outcome === 'healed' ? ctx.proposal?.confidence : undefined,
    reasoning: ctx.proposal?.reasoning,
    durationMs: Date.now() - startedAt,
  };

  mkdirSync(options.healsDir, { recursive: true });
  writeFileSync(
    join(options.healsDir, basename(artifactPath).replace(/\.json$/, '-heal.json')),
    JSON.stringify(heal, null, 2),
  );
  return heal;
}
