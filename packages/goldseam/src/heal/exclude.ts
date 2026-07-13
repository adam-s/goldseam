// Author-declared heal exclusions: a committed, reviewed guarantee that
// goldseam NEVER heals a deliberately-red test — a negative/security
// assertion, a regression the team is tracking, a quarantined flake.
//
// The problem this solves: the only prior lever was the CLI `--skip`, which is
// ad-hoc, uncommitted, and *silently drops* the capture. An exclusion is
// different in kind — it lives in `goldseam.config.mjs` (durable, reviewed) and
// produces a first-class, REPORTED give-up: the team's decision to keep a test
// red is recorded in the heal artifact, not hidden. (Incumbent parity:
// Healenium's `@DisableHealing`; cy.prompt offers no opt-out at all.)

import { HealExclusion } from '../shared/config';
import { FailureArtifact } from '../shared/types';

export { HealExclusion };

/**
 * The first exclusion that matches `artifact`, with a human-readable reason, or
 * null. Pure and model-free — the unit-test surface. An object with no match
 * fields matches nothing (a `reason`-only rule must never exclude everything).
 */
export function matchExclusion(
  artifact: Pick<FailureArtifact, 'specPath' | 'title' | 'failedSelector'>,
  exclude: readonly HealExclusion[] | undefined,
): { reason: string } | null {
  for (const rule of exclude ?? []) {
    if (typeof rule === 'string') {
      if (artifact.specPath.includes(rule) || artifact.title.includes(rule)) {
        return { reason: `matches "${rule}"` };
      }
      continue;
    }
    const conditions: boolean[] = [];
    if (rule.spec !== undefined) conditions.push(artifact.specPath.includes(rule.spec));
    if (rule.title !== undefined) conditions.push(artifact.title.includes(rule.title));
    if (rule.selector !== undefined) {
      conditions.push((artifact.failedSelector ?? '').includes(rule.selector));
    }
    if (conditions.length > 0 && conditions.every(Boolean)) {
      return { reason: rule.reason ?? describeRule(rule) };
    }
  }
  return null;
}

function describeRule(rule: { spec?: string; title?: string; selector?: string }): string {
  return (['spec', 'title', 'selector'] as const)
    .filter((k) => rule[k] !== undefined)
    .map((k) => `${k}=${JSON.stringify(rule[k])}`)
    .join(' & ');
}
