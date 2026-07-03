// Heal-side domain types. The heal artifact is a public API like the
// capture artifact: stages are config, verdicts are artifacts, so later
// rungs (mutation-guard, adversary, review) are inserted stage
// implementations — never pipeline refactors.

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
  /** 'cache' = healed from heal memory, zero model calls (still verified). */
  tier: 'cache' | 'model';
  verdict: 'healed' | 'gave-up' | 'failed';
  attempts: HealAttempt[];
  finalEdits?: RepairEdit[];
  confidence?: number;
  reasoning?: string;
  durationMs: number;
}

export interface HealContext {
  artifact: FailureArtifact;
  artifactPath: string;
  options: HealOptions;
  runner: RepairRunner;
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
