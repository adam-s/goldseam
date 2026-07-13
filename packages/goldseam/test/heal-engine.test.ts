// Engine tests with a stub runner: the ladder, the attempt cap, the
// feedback loop, give-up short-circuits, and apply/revert semantics —
// no model, no Cypress (stages: propose only).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_HEAL_OPTIONS, healArtifactFile } from '../src/heal/engine';
import { HealOptions } from '../src/heal/types';
import { stubRunner } from './helpers';

const SPEC_REL = 'cypress/e2e/cart.cy.ts';
const SPEC = `it('adds', () => {
  cy.visit('/');
  cy.get('#add-to-basket').click();
});
`;
const GOOD_REPLY = JSON.stringify({
  edits: [{ file: SPEC_REL, oldString: `cy.get('#add-to-basket')`, newString: `cy.get('#add-to-cart')` }],
  confidence: 0.9,
  reasoning: 'button id changed',
});

let root: string;
let artifactPath: string;

function makeOptions(overrides: Partial<HealOptions> = {}): HealOptions {
  return {
    ...DEFAULT_HEAL_OPTIONS,
    stages: ['propose'],
    projectRoot: root,
    healsDir: join(root, '.goldseam', 'heals'),
    cacheFile: null,
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'goldseam-heal-'));
  mkdirSync(join(root, 'cypress', 'e2e'), { recursive: true });
  writeFileSync(join(root, SPEC_REL), SPEC);
  const failuresDir = join(root, '.goldseam', 'failures');
  mkdirSync(failuresDir, { recursive: true });
  artifactPath = join(failuresDir, 'cart-abc123.json');
  writeFileSync(
    artifactPath,
    JSON.stringify({
      schemaVersion: 1,
      title: 'adds',
      specPath: SPEC_REL,
      errorMessage: 'Expected to find element: `#add-to-basket`',
      url: 'http://localhost:4173/',
      domHtml: '<html><body><button id="add-to-cart">Add to cart</button></body></html>',
      ariaSnapshot: '- button "Add to cart"',
      redacted: true,
    }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('healArtifactFile', () => {
  it('heals with a valid proposal: edit applied, artifact written', async () => {
    const runner = stubRunner([GOOD_REPLY]);
    const heal = await healArtifactFile(artifactPath, runner, makeOptions());
    expect(heal.verdict).toBe('healed');
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toContain('#add-to-cart');
    expect(heal.finalEdits?.[0]?.newString).toContain('#add-to-cart');
    const healFiles = readdirSync(join(root, '.goldseam', 'heals'));
    expect(healFiles).toEqual(['cart-abc123-heal.json']);
  });

  it('dry-run proposes but leaves the spec untouched', async () => {
    const heal = await healArtifactFile(artifactPath, stubRunner([GOOD_REPLY]), makeOptions({ dryRun: true }));
    expect(heal.verdict).toBe('healed');
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC);
  });

  it('dry-run writes NO heal cache — an unverified mapping must not enter heal memory', async () => {
    // With a failedSelector, the cache path is reachable; and in dry-run the
    // rerun rungs short-circuit to pass, so `healed` is UNVERIFIED.
    writeFileSync(
      artifactPath,
      JSON.stringify({
        schemaVersion: 1,
        title: 'adds',
        specPath: SPEC_REL,
        errorMessage: 'Expected to find element: `#add-to-basket`',
        url: 'http://localhost:4173/',
        domHtml: '<html><body><button id="add-to-cart">Add to cart</button></body></html>',
        ariaSnapshot: '- button "Add to cart"',
        redacted: true,
        failedSelector: '#add-to-basket',
      }),
    );
    const cacheFile = join(root, '.goldseam', 'heal-cache.json');
    const dry = await healArtifactFile(artifactPath, stubRunner([GOOD_REPLY]), makeOptions({ dryRun: true, cacheFile }));
    expect(dry.verdict).toBe('healed');
    expect(existsSync(cacheFile)).toBe(false); // the fix: dry-run mutates nothing on disk
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC); // spec untouched too

    // Control: a real (non-dry) run DOES cache — proves this test would catch a regression.
    const real = await healArtifactFile(artifactPath, stubRunner([GOOD_REPLY]), makeOptions({ cacheFile }));
    expect(real.verdict).toBe('healed');
    expect(existsSync(cacheFile)).toBe(true);
  });

  it('short-circuits to gave-up on about:blank without calling the model', async () => {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    writeFileSync(artifactPath, JSON.stringify({ ...artifact, url: 'about:blank' }));
    const runner = stubRunner([GOOD_REPLY]);
    const heal = await healArtifactFile(artifactPath, runner, makeOptions());
    expect(heal.verdict).toBe('gave-up');
    expect(runner.calls).toBe(0);
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC);
  });

  it('respects a model give-up', async () => {
    const heal = await healArtifactFile(
      artifactPath,
      stubRunner([JSON.stringify({ giveUp: { reason: 'no plausible target' }, reasoning: 'r' })]),
      makeOptions(),
    );
    expect(heal.verdict).toBe('gave-up');
  });

  it('treats low confidence as give-up', async () => {
    const lowConf = JSON.parse(GOOD_REPLY);
    lowConf.confidence = 0.2;
    const heal = await healArtifactFile(artifactPath, stubRunner([JSON.stringify(lowConf)]), makeOptions());
    expect(heal.verdict).toBe('gave-up');
  });

  it('retries with feedback after a rejected proposal and heals on attempt 2', async () => {
    const runner = stubRunner(['this is not json', GOOD_REPLY]);
    const heal = await healArtifactFile(artifactPath, runner, makeOptions());
    expect(heal.verdict).toBe('healed');
    expect(heal.attempts).toHaveLength(2);
    expect(heal.attempts[0].ladder[0].verdict).toBe('fail');
    expect(runner.calls).toBe(2);
  });

  it('fails after the hard attempt cap and reverts', async () => {
    const runner = stubRunner(['garbage']);
    const heal = await healArtifactFile(artifactPath, runner, makeOptions({ maxAttempts: 3 }));
    expect(heal.verdict).toBe('failed');
    expect(heal.attempts).toHaveLength(3);
    expect(runner.calls).toBe(3);
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC);
  });
});

describe('red-team regressions', () => {
  it('rejects a capture whose specPath escapes the project', async () => {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    writeFileSync(artifactPath, JSON.stringify({ ...artifact, specPath: '../outside.cy.ts' }));
    await expect(healArtifactFile(artifactPath, stubRunner([GOOD_REPLY]), makeOptions())).rejects.toThrow(
      /outside the project/,
    );
  });

  it("applies '$&'-style replacement text literally", async () => {
    const dollarReply = JSON.stringify({
      edits: [{ file: SPEC_REL, oldString: `cy.get('#add-to-basket')`, newString: `cy.get('#a-$&-b')` }],
      confidence: 0.9,
      reasoning: 'r',
    });
    const heal = await healArtifactFile(artifactPath, stubRunner([dollarReply]), makeOptions());
    expect(heal.verdict).toBe('healed');
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toContain(`cy.get('#a-$&-b')`);
  });
});

describe('infrastructure failures', () => {
  it('aborts after one attempt when Cypress itself cannot run (no retry burn)', async () => {
    const { STAGES } = await import('../src/heal/stages');
    STAGES['broken-runner'] = {
      name: 'broken-runner',
      async run() {
        return {
          stage: 'broken-runner',
          verdict: 'fail',
          evidence: 'cypress could not run: Could not find Cypress test run results',
          durationMs: 0,
        };
      },
    };
    try {
      const runner = stubRunner([GOOD_REPLY]);
      const heal = await healArtifactFile(
        artifactPath,
        runner,
        makeOptions({ stages: ['propose', 'broken-runner'], maxAttempts: 3 }),
      );
      expect(heal.verdict).toBe('failed');
      expect(heal.attempts).toHaveLength(1); // no identical re-proposals against a broken runner
      expect(runner.calls).toBe(1);
      expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC); // reverted
    } finally {
      delete STAGES['broken-runner'];
    }
  });
});

describe('sibling-heal detection', () => {
  it('a comment mentioning the broken selector does not defeat the probe (proving-campaign)', async () => {
    // spec is ALREADY healed; the selector survives only in a comment
    writeFileSync(
      join(root, SPEC_REL),
      `// legacy id: #add-to-basket\nit('adds', () => {\n  cy.get('#add-to-cart').click();\n});\n`,
    );
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    writeFileSync(artifactPath, JSON.stringify({ ...artifact, failedSelector: '#add-to-basket' }));
    const { STAGES } = await import('../src/heal/stages');
    const realRerun = STAGES['rerun-test'];
    STAGES['rerun-test'] = {
      name: 'rerun-test',
      async run() {
        return { stage: 'rerun-test', verdict: 'pass', evidence: 'probe green', durationMs: 0 };
      },
    };
    try {
      const runner = stubRunner([GOOD_REPLY]);
      const heal = await healArtifactFile(artifactPath, runner, makeOptions());
      expect(heal.tier).toBe('sibling');
      expect(heal.verdict).toBe('healed');
      expect(runner.calls).toBe(0); // no model call for an already-healed break
    } finally {
      STAGES['rerun-test'] = realRerun;
    }
  });

  it('a stale capture (selector gone, probe not green) gives up with zero model calls', async () => {
    // The fresh-consumer walkthrough burned 3 real model calls reprocessing
    // a capture whose break was already healed: edits anchored on an absent
    // selector can never validate, so the model must not be consulted.
    writeFileSync(join(root, SPEC_REL), `it('adds', () => {\n  cy.get('#add-to-cart').click();\n});\n`);
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    writeFileSync(artifactPath, JSON.stringify({ ...artifact, failedSelector: '#add-to-basket' }));
    const { STAGES } = await import('../src/heal/stages');
    const realRerun = STAGES['rerun-test'];
    STAGES['rerun-test'] = {
      name: 'rerun-test',
      async run() {
        return { stage: 'rerun-test', verdict: 'fail', evidence: 'suite red for another reason', durationMs: 0 };
      },
    };
    try {
      const runner = stubRunner([GOOD_REPLY]);
      const heal = await healArtifactFile(artifactPath, runner, makeOptions());
      expect(heal.verdict).toBe('gave-up');
      expect(heal.attempts[0].ladder.at(-1)?.evidence).toMatch(/stale capture/);
      expect(runner.calls).toBe(0);
      expect(readFileSync(join(root, SPEC_REL), 'utf8')).toContain('#add-to-cart'); // spec untouched
    } finally {
      STAGES['rerun-test'] = realRerun;
    }
  });
});

describe('apply/revert on rejection', () => {
  it('a proposal applied to disk is reverted when a later rung rejects it (suite-bites gap)', async () => {
    const { STAGES } = await import('../src/heal/stages');
    STAGES['apply-then-fail'] = {
      name: 'apply-then-fail',
      async run(ctx) {
        ctx.apply(); // mimic a rerun rung: edit hits disk before the verdict
        return { stage: 'apply-then-fail', verdict: 'fail', evidence: 'rejected after apply', durationMs: 0 };
      },
    };
    try {
      const heal = await healArtifactFile(
        artifactPath,
        stubRunner([GOOD_REPLY]),
        makeOptions({ stages: ['propose', 'apply-then-fail'], maxAttempts: 1 }),
      );
      expect(heal.verdict).toBe('failed');
      expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC); // reverted, byte-for-byte
    } finally {
      delete STAGES['apply-then-fail'];
    }
  });
});

describe('retry economics', () => {
  it('stops after an identical proposal fails identically twice (no third model call)', async () => {
    const { STAGES } = await import('../src/heal/stages');
    STAGES['always-reject'] = {
      name: 'always-reject',
      async run() {
        return { stage: 'always-reject', verdict: 'fail', evidence: 'rejected: same reason', durationMs: 0 };
      },
    };
    try {
      const runner = stubRunner([GOOD_REPLY]); // same reply every attempt
      const heal = await healArtifactFile(
        artifactPath,
        runner,
        makeOptions({ stages: ['propose', 'always-reject'], maxAttempts: 5 }),
      );
      expect(heal.verdict).toBe('failed');
      expect(heal.attempts).toHaveLength(2); // once + one retry proves it's stuck; never five
      expect(runner.calls).toBe(2);
    } finally {
      delete STAGES['always-reject'];
    }
  });
});

describe('heal memory (cache tier)', () => {
  // The capture's failedSelector must be derivable for caching; the
  // beforeEach artifact lacks one, so write it explicitly here.
  function setFailedSelector() {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    writeFileSync(
      artifactPath,
      JSON.stringify({ ...artifact, failedSelector: '#add-to-basket' }),
    );
  }
  const cacheFile = () => join(root, '.goldseam', 'heal-cache.json');

  it('a verified model heal records a cache entry', async () => {
    setFailedSelector();
    const heal = await healArtifactFile(artifactPath, stubRunner([GOOD_REPLY]), makeOptions({ cacheFile: cacheFile() }));
    expect(heal.tier).toBe('model');
    const cache = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    expect(cache).toEqual([
      expect.objectContaining({ failedSelector: '#add-to-basket', replacement: '#add-to-cart' }),
    ]);
  });

  it('a cache hit heals with zero model calls, tier=cache, still verified by the ladder', async () => {
    setFailedSelector();
    writeFileSync(
      cacheFile(),
      JSON.stringify([
        { failedSelector: '#add-to-basket', replacement: '#add-to-cart', healedAt: 'x', specPath: 'other.cy.ts' },
      ]),
    );
    const runner = stubRunner([GOOD_REPLY]);
    const heal = await healArtifactFile(artifactPath, runner, makeOptions({ cacheFile: cacheFile() }));
    expect(heal.verdict).toBe('healed');
    expect(heal.tier).toBe('cache');
    expect(runner.calls).toBe(0);
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toContain('#add-to-cart');
  });

  it('a poisoned cache replacement fails validation and falls through to the model', async () => {
    setFailedSelector();
    writeFileSync(
      cacheFile(),
      JSON.stringify([
        {
          failedSelector: '#add-to-basket',
          replacement: "#x').should('exist');//",
          healedAt: 'x',
          specPath: 'o.cy.ts',
        },
      ]),
    );
    const runner = stubRunner([GOOD_REPLY]);
    const heal = await healArtifactFile(artifactPath, runner, makeOptions({ cacheFile: cacheFile() }));
    expect(heal.verdict).toBe('healed');
    expect(heal.tier).toBe('model'); // cache proposal rejected by the validator
    expect(runner.calls).toBe(1);
  });

  it('an inapplicable cache entry falls through to the model in the same attempt', async () => {
    setFailedSelector();
    writeFileSync(
      cacheFile(),
      JSON.stringify([
        { failedSelector: '#something-else', replacement: '#whatever', healedAt: 'x', specPath: 'o.cy.ts' },
      ]),
    );
    const runner = stubRunner([GOOD_REPLY]);
    const heal = await healArtifactFile(artifactPath, runner, makeOptions({ cacheFile: cacheFile() }));
    expect(heal.verdict).toBe('healed');
    expect(heal.tier).toBe('model');
    expect(runner.calls).toBe(1);
    expect(heal.attempts).toHaveLength(1);
  });

  it('a cache proposal rejected by a later rung falls back to the model on the next attempt', async () => {
    setFailedSelector();
    writeFileSync(
      cacheFile(),
      JSON.stringify([
        { failedSelector: '#add-to-basket', replacement: '#stale-cached-target', healedAt: 'x', specPath: 'o.cy.ts' },
      ]),
    );
    // Temporary rung that rejects the stale cache proposal but passes the
    // model's; registered directly in the STAGES registry.
    const { STAGES } = await import('../src/heal/stages');
    STAGES['reject-stale'] = {
      name: 'reject-stale',
      async run(ctx) {
        const bad = ctx.proposal?.edits?.[0]?.newString.includes('stale');
        return { stage: 'reject-stale', verdict: bad ? 'fail' : 'pass', evidence: bad ? 'stale' : 'ok', durationMs: 0 };
      },
    };
    try {
      const runner = stubRunner([GOOD_REPLY]);
      const heal = await healArtifactFile(
        artifactPath,
        runner,
        makeOptions({ cacheFile: cacheFile(), stages: ['propose', 'reject-stale'], maxAttempts: 2 }),
      );
      expect(heal.verdict).toBe('healed');
      expect(heal.tier).toBe('model');
      expect(heal.attempts.map((a) => a.source)).toEqual(['cache', 'model']);
      expect(runner.calls).toBe(1);
    } finally {
      delete STAGES['reject-stale'];
    }
  });
});

describe('heal exclusions', () => {
  it('an excluded capture gives up "excluded" WITHOUT calling the model; a non-match still heals', async () => {
    const runner = stubRunner([GOOD_REPLY]);
    const excluded = await healArtifactFile(
      artifactPath,
      runner,
      makeOptions({ exclude: [{ spec: 'cart', reason: 'tracked regression' }] }),
    );
    expect(excluded.verdict).toBe('gave-up');
    expect(excluded.tier).toBe('excluded');
    expect(excluded.attempts[0].ladder[0].evidence).toMatch(/excluded by directive \(tracked regression\)/);
    expect(runner.calls).toBe(0); // the load-bearing guarantee: never sent to the model
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC); // spec untouched

    const runner2 = stubRunner([GOOD_REPLY]);
    const healed = await healArtifactFile(artifactPath, runner2, makeOptions({ exclude: ['does-not-match'] }));
    expect(healed.verdict).toBe('healed');
    expect(runner2.calls).toBe(1); // the filter is specific — a non-match heals normally
  });

  it('excludes cleanly for a since-deleted spec (gives up, does not throw on the missing spec)', async () => {
    rmSync(join(root, SPEC_REL)); // the spec is gone
    const heal = await healArtifactFile(artifactPath, stubRunner([GOOD_REPLY]), makeOptions({ exclude: ['cart'] }));
    expect(heal.verdict).toBe('gave-up');
    expect(heal.tier).toBe('excluded'); // short-circuits BEFORE the spec-existence check
  });
});
