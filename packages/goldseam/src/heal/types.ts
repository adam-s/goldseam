// Heal-side domain types. The heal artifact is a public API like the
// capture artifact: stages are config, verdicts are artifacts, so later
// rungs (mutation-guard, adversary, review) are inserted stage
// implementations — never pipeline refactors.

import { HealExclusion } from '../shared/config';
import { FailureArtifact } from '../shared/types';

export const HEAL_SCHEMA_VERSION = 1;

export interface RepairEdit {
  file: string;
  oldString: string;
  newString: string;
}

/** Strict-JSON reply contract; the prompt doc and this type are the same API. */
export interface RepairReply {
  edits?: RepairEdit[];
  confidence?: number;
  reasoning?: string;
  giveUp?: { reason: string };
}

/** A model runner: rendered prompt in, raw model text out. */
export interface RepairRunner {
  id: string;
  repair(prompt: string): Promise<string>;
}

/** One test's known-good target identity: the aria role + accessible name
 * of the element its selector pointed at while the test was green. The
 * oracle rung requires a healed selector to land on an element matching
 * this identity — the guard against plausible impostors. */
export interface OracleEntry {
  specPath: string;
  title: string;
  /** The green-run selector this identity was harvested for; absent on
   * hand-written test-level entries. */
  selector?: string;
  role: string;
  /** Exact accessible name; omit to match by role alone. */
  name?: string;
}

export type Verdict = 'pass' | 'fail' | 'gave-up';

export interface StageVerdict {
  stage: string;
  verdict: Verdict;
  evidence: string;
  durationMs: number;
}

export interface HealOptions {
  /** Stage names to run, in order. The Phase-1 parity ladder by default. */
  stages: string[];
  /** Hard cap on propose attempts. */
  maxAttempts: number;
  /** Below this confidence the proposal is treated as a give-up. */
  minConfidence: number;
  /** Order the model is told to prefer when choosing replacement selectors. */
  selectorPriority: string[];
  dryRun: boolean;
  projectRoot: string;
  healsDir: string;
  /** Heal-memory file; null disables the cache tier. */
  cacheFile: string | null;
  /** Known-good identity file for the oracle rung; the rung skips (with
   * evidence) when unset or missing. */
  oracleFile?: string | null;
  /** Cypress config file for the rerun rungs (monorepo per-app configs). */
  configFile?: string;
  /** Titles of OTHER captures still awaiting heals in the same spec —
   * rerun-spec tolerates exactly these failures and nothing else. */
  knownBrokenTitles?: string[];
  /** Author-declared exclusions — captures matching any of these are never
   * healed; they give up "excluded" before any model call. */
  exclude?: readonly HealExclusion[];
}

export interface HealAttempt {
  attempt: number;
  proposal?: RepairReply;
  proposalError?: string;
  /** Where the proposal came from. */
  source?: 'cache' | 'model';
  ladder: StageVerdict[];
}

export interface HealArtifact {
  schemaVersion: number;
  captureRef: string;
  specPath: string;
  title: string;
  model: string;
  /** 'cache' = healed from heal memory (zero model calls); 'sibling' = an
   * earlier heal in the same run already fixed this break (verified by
   * rerun, zero model calls). */
  tier: 'cache' | 'model' | 'sibling' | 'excluded';
  verdict: 'healed' | 'gave-up' | 'failed';
  attempts: HealAttempt[];
  finalEdits?: RepairEdit[];
  /** Verified-but-review-me signals (e.g. weak-assertions). Additive;
   * flags route human attention and never block a heal. */
  reviewFlags?: string[];
  confidence?: number;
  reasoning?: string;
  durationMs: number;
}

export interface HealContext {
  artifact: FailureArtifact;
  artifactPath: string;
  options: HealOptions;
  runner: RepairRunner;
  /** The failing spec's source as the engine validated and read it. All
   * offline rungs run before apply(), so this IS the on-disk content —
   * one read, one path semantics, no per-stage re-reads. */
  specSource: string;
  /** Set by the propose stage; consumed by verify stages. */
  proposal?: RepairReply;
  /** Where the current proposal came from (propose stage sets it). */
  proposalSource?: 'cache' | 'model';
  /** True once the cache tier has been tried this heal — never retried. */
  cacheTried?: boolean;
  /** Feedback from a failed attempt, folded into the next prompt. */
  feedback?: string;
  /** Apply/revert the proposed edit on disk (engine-provided, idempotent). */
  apply(): void;
  revert(): void;
}

export interface HealStage {
  name: string;
  run(ctx: HealContext): Promise<StageVerdict>;
}
