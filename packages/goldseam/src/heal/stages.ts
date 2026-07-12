// The Phase-1 ladder rungs. Each stage reads the context and returns a
// verdict artifact; any failing rung stops the attempt. Later rungs
// (oracle, mutation-guard, adversary…) register here without touching the
// engine.

import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getAllByAria, queryAllDeep } from 'aria-snapshot';
import { buildCacheEdit, loadCache, lookup } from './cache';
import { closeWindow, parseDom, withDomGlobals } from './dom-env';
import { buildRepairPrompt } from './prompt';
import { parseRepairReply, ReplyParseError } from './parse';
import {
  countSelectorMatches,
  countTextMatches,
  healedSiteForEdit,
  HOOK_TITLE_RE,
  impliesCollection,
} from './resolve';
import { EditRejected, validateEdits } from './validate';
import { HealContext, HealStage, OracleEntry, StageVerdict } from './types';

const verdict = (
  stage: string,
  v: StageVerdict['verdict'],
  evidence: string,
  started: number,
): StageVerdict => ({ stage, verdict: v, evidence, durationMs: Date.now() - started });

// Pre-model triage (.agents/reference/disambiguation.md): not every "not found" is
// selector drift. If the selector Cypress could never find STILL matches
// the captured DOM, the element arrived after the retry window or is
// state-gated — a timing/state failure no selector edit can fix. Give up
// honestly before spending a model call on it.
export const triageStage: HealStage = {
  name: 'triage',
  async run(ctx: HealContext): Promise<StageVerdict> {
    const started = Date.now();
    const { artifact } = ctx;
    const selector = artifact.failedSelector;
    if (!selector) {
      return verdict('triage', 'pass', 'no selector parsed from the error — nothing to triage', started);
    }
    // A .find()/.within() failure is scoped to a parent element; a global
    // count would false-positive on same-named elements elsewhere.
    if (/Queried from/.test(artifact.errorMessage)) {
      return verdict('triage', 'pass', 'selector was scoped to a parent element — static triage skipped', started);
    }
    const match = countSelectorMatches(artifact.domHtml, selector, 'state');
    if (match === null) {
      return verdict('triage', 'pass', `selector not statically checkable ("${selector}") — triage skipped`, started);
    }
    if (match.count > 0 && match.count === match.frameCount) {
      return verdict(
        'triage',
        'gave-up',
        `the "missing" selector matches ${match.count} element(s) only inside a same-origin iframe in the ` +
          'capture — bare cy.get does not reach into frames; this is a frame-scoping problem, not selector ' +
          'drift, and a selector edit cannot fix it',
        started,
      );
    }
    if (match.count > 0) {
      return verdict(
        'triage',
        'gave-up',
        `the "missing" selector still matches ${match.count} element(s) in the captured DOM` +
          `${match.approximate ? ' (ignoring state pseudo-classes)' : ''} — it appeared after Cypress stopped ` +
          'retrying or is state-gated (timing/visibility, not selector drift); a selector edit cannot fix this',
        started,
      );
    }
    return verdict('triage', 'pass', 'failed selector confirmed absent from the captured DOM', started);
  },
};

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

    // The engine validated and read the spec once; propose/resolve/oracle
    // all run before apply(), so ctx.specSource IS the on-disk content.
    const specSource = ctx.specSource;

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

// Static resolution of the proposal against the captured DOM — the DOM
// the model itself saw (.agents/reference/disambiguation.md). A healed selector that
// matches nothing is a hallucination; one that matches several elements
// where the chain expects one is ambiguous. Both reject offline, with
// feedback, before any rerun — and a rejection here is also the guard
// against healing onto a nonexistent target when the surviving assertions
// are too weak for the rerun to notice.
export const resolveStage: HealStage = {
  name: 'resolve',
  async run(ctx: HealContext): Promise<StageVerdict> {
    const started = Date.now();
    const { artifact, options } = ctx;
    const edits = ctx.proposal?.edits;
    if (!edits?.length) {
      return verdict('resolve', 'pass', 'no proposed edits — nothing to resolve', started);
    }
    const truncNote = artifact.domTruncated ? ' (note: the capture DOM was truncated)' : '';
    const specSource = ctx.specSource;
    const notes: string[] = [];
    for (const edit of edits) {
      const healed = healedSiteForEdit(specSource, edit);
      if (!healed) {
        notes.push('could not locate the edited selector string — deferred to rerun');
        continue;
      }
      const { site, healedSource } = healed;
      if (site.call === 'contains') {
        const n = countTextMatches(artifact.domHtml, site.value);
        if (n === 0) {
          return verdict(
            'resolve',
            'fail',
            `contains("${site.value}") matches no element text in the captured DOM${truncNote} — propose content that is actually on the page`,
            started,
          );
        }
        notes.push(`contains("${site.value}"): ${n} match(es)`); // several is legal: contains takes the first
        continue;
      }
      const match = countSelectorMatches(artifact.domHtml, site.value, 'all');
      if (match === null) {
        notes.push(`"${site.value}" not statically checkable — deferred to rerun`);
        continue;
      }
      if (match.count === 0) {
        return verdict(
          'resolve',
          'fail',
          `healed selector "${site.value}" matches nothing in the captured DOM${truncNote} — it points at an element that does not exist; pick a selector present in the DOM or aria snapshot`,
          started,
        );
      }
      // find/children/…: parent-scoped, so a whole-document count
      // over-approximates — enforce existence only.
      const scoped = site.call !== 'get';
      if (match.count > 1 && !scoped && !match.approximate && !impliesCollection(healedSource, site.end)) {
        return verdict(
          'resolve',
          'fail',
          `healed selector "${site.value}" is ambiguous — it matches ${match.count} elements in the captured DOM and the call chain expects one; propose a selector unique to the intended element`,
          started,
        );
      }
      notes.push(
        `"${site.value}": ${match.count} match(es)` +
          `${match.approximate ? ' (approximate)' : ''}${scoped ? ' (scoped call — existence only)' : ''}` +
          `${match.count > 0 && match.count === match.frameCount ? ' (all inside iframe content — reachable only through a frame-entry helper; the rerun decides)' : ''}`,
      );
    }
    return verdict('resolve', 'pass', notes.join('; '), started);
  },
};

// The oracle rung: identity, not just existence. resolve proves the healed
// selector points at SOMETHING; the rerun proves the test PASSES; neither
// proves the selector points at the element the test meant. When a
// known-good identity (aria role + accessible name recorded while the
// test was green) is available, this rung requires the healed selector to
// land on an element matching it — the impostor guard, offline, in the
// DOM the model saw. Sound, not complete: no identity on file means a
// skip with evidence, never a silent verdict.
export const oracleStage: HealStage = {
  name: 'oracle',
  async run(ctx: HealContext): Promise<StageVerdict> {
    const started = Date.now();
    const { artifact, options } = ctx;
    const edits = ctx.proposal?.edits;
    if (!edits?.length) {
      return verdict('oracle', 'pass', 'no proposed edits — nothing to check', started);
    }
    const file = options.oracleFile;
    if (!file || !existsSync(file)) {
      return verdict('oracle', 'pass', 'no known-good identity file — oracle skipped', started);
    }
    let entries: OracleEntry[];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('not an array');
      entries = parsed as OracleEntry[];
    } catch (e) {
      return verdict(
        'oracle',
        'pass',
        `oracle file unreadable (${e instanceof Error ? e.message : e}) — oracle skipped`,
        started,
      );
    }
    // Prefer the identity harvested for the EXACT selector that broke;
    // fall back to a hand-written test-level entry (no selector field).
    // Other selectors' identities are not this break's oracle.
    const forTest = entries.filter(
      (o) => o.specPath === artifact.specPath && o.title === artifact.title,
    );
    const entry =
      forTest.find((o) => o.selector !== undefined && o.selector === artifact.failedSelector) ??
      forTest.find((o) => o.selector === undefined);
    if (!entry) {
      return verdict('oracle', 'pass', 'no known-good identity for this test — oracle skipped', started);
    }
    const identity = `${entry.role}${entry.name !== undefined ? ` "${entry.name}"` : ''}`;

    const { window } = parseDom(artifact.domHtml);
    const specSource = ctx.specSource;

    // The aria walk reads live nodes for the whole closure; close the window
    // only after withDomGlobals returns (the verdict it yields holds strings).
    try {
      return withDomGlobals(window, () => {
      const docEl = window.document.documentElement;
      // Judge on the UNEXPANDED capture: the aria walk descends serialized
      // templates natively and queryAllDeep respects boundaries, so both
      // queries see the same element objects WITHOUT collapsing shadow and
      // frame boundaries the live page enforces (red-team finding: an
      // expanded DOM let selectors match across boundaries and shifted
      // :nth-of-type positions with wrapper divs).
      // Oracle files are user data: an unknown role simply matches nothing
      // and lands in the gave-up path below, so the cast is safe.
      const wanted = getAllByAria(docEl, {
        kind: 'role',
        role: entry.role as import('aria-snapshot').AriaRole,
        ...(entry.name !== undefined ? { name: entry.name } : {}),
      });
      if (wanted.length === 0) {
        return verdict(
          'oracle',
          'gave-up',
          `the known-good ${identity} no longer exists in the capture — the intended element is gone; a selector edit cannot resurrect it`,
          started,
        );
      }

      const notes: string[] = [];
      for (const edit of edits) {
        const healed = healedSiteForEdit(specSource, edit);
        if (!healed) {
          notes.push('could not locate the edited selector — unverified');
          continue;
        }
        const { site, healedSource } = healed;
        if (site.call === 'contains') {
          if (!wanted.some((el) => el.textContent?.includes(site.value))) {
            return verdict(
              'oracle',
              'fail',
              `contains("${site.value}") does not select the known-good ${identity} — impostor guard`,
              started,
            );
          }
          continue;
        }
        let matched: Element[];
        try {
          matched = queryAllDeep(window.document, site.value);
        } catch {
          notes.push(`"${site.value}" not statically checkable — unverified`);
          continue;
        }
        if (matched.length === 0) {
          // resolve should have caught this; stay honest either way
          return verdict(
            'oracle',
            'fail',
            `healed selector "${site.value}" matches nothing in the capture — cannot target the known-good ${identity}`,
            started,
          );
        }
        // Judge the element Cypress would ACT on, not "any match": a
        // multi-match selector behind .first()/.last()/.eq(n) acts
        // positionally, and blessing "some match is the right one" lets an
        // impostor ride first in document order (red-team finding).
        const chain = healedSource.slice(site.end, site.end + 200);
        const eq = chain.match(/^[^;]*?\.(?:eq\((\d+)\)|(first)\(\)|(last)\(\))/);
        let judged: Element[];
        if (eq) {
          const index = eq[2] ? 0 : eq[3] ? matched.length - 1 : Number(eq[1]);
          judged = matched[index] ? [matched[index]] : [];
        } else if (matched.length === 1) {
          judged = matched;
        } else {
          // other collection chains (.each/.filter/have.length) act on
          // several elements — require them ALL to carry the identity
          judged = matched;
        }
        if (judged.length === 0 || !judged.every((el) => wanted.includes(el))) {
          return verdict(
            'oracle',
            'fail',
            `healed selector "${site.value}" targets a different element than the known-good ${identity} — impostor guard`,
            started,
          );
        }
      }
      return verdict(
        'oracle',
        'pass',
        `healed selector targets the known-good ${identity}${notes.length ? ` (${notes.join('; ')})` : ''}`,
        started,
      );
      });
    } finally {
      closeWindow(window);
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

  // A hook-failure capture carries mocha's hook title ('suite "before
  // each" hook'), which no TEST ever bears — the healed hook has no
  // single test to find (proving-campaign finding, TodoMVC: a correct
  // multi-edit heal was rejected as 'did not run' while all 4 gated
  // tests passed). Success for a hook heal = the suite ran past the
  // hook and nothing failed beyond the known pending breaks.
  if (HOOK_TITLE_RE.test(healedTitle)) {
    // At least one test must actually PASS: an all-pending/skipped run
    // means the suite never truly executed (red-team: vacuous pass). For
    // after-hooks the gated tests run BEFORE the hook fires, so "no
    // failures" is load-bearing — Cypress attributes a broken after-hook
    // to a failed test, which the unexpected check below catches.
    const passed = tests.filter((t) => t.state === 'passed').length;
    if (passed === 0) {
      return { pass: false, evidence: `hook heal: no test passed (${tests.length} ran) — the suite still aborts or skips` };
    }
    const failed = tests.filter((t) => t.state === 'failed').map(byTitle);
    const unexpected = failed.filter((t) => !knownBrokenTitles.includes(t));
    if (unexpected.length > 0) {
      return {
        pass: false,
        evidence: `hook heal: suite ran but ${unexpected.length} test(s) still fail: ${unexpected.join('; ')}`,
      };
    }
    return {
      pass: true,
      evidence: `hook failure healed: ${passed} test(s) passed past the hook${failed.length > 0 ? ` (${failed.length} known pending break(s))` : ''}`,
    };
  }

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
    ...(ctx.options.configFile ? { configFile: ctx.options.configFile } : {}),
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
  // Hook titles match no test — grepping by them would filter the run to
  // nothing; a hook heal reruns the whole spec.
  run: (ctx) =>
    rerun(ctx, 'rerun-test', HOOK_TITLE_RE.test(ctx.artifact.title) ? undefined : ctx.artifact.title),
};

export const rerunSpecStage: HealStage = {
  name: 'rerun-spec',
  run: (ctx) => rerun(ctx, 'rerun-spec'),
};

export const STAGES: Record<string, HealStage> = {
  triage: triageStage,
  propose: proposeStage,
  resolve: resolveStage,
  oracle: oracleStage,
  'rerun-test': rerunTestStage,
  'rerun-spec': rerunSpecStage,
};
