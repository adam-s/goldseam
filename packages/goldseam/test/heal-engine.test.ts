// Engine tests with a stub runner: the ladder, the attempt cap, the
// feedback loop, give-up short-circuits, and apply/revert semantics —
// no model, no Cypress (stages: propose only).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_HEAL_OPTIONS, healArtifactFile } from '../src/heal/engine';
import { HealOptions, RepairRunner } from '../src/heal/types';

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
    ...overrides,
  };
}

function stubRunner(replies: string[]): RepairRunner & { calls: number } {
  const runner = {
    id: 'cmd:stub',
    calls: 0,
    async repair(): Promise<string> {
      const reply = replies[Math.min(runner.calls, replies.length - 1)];
      runner.calls++;
      return reply;
    },
  };
  return runner;
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
    expect(heal.finalEdit?.newString).toContain('#add-to-cart');
    const healFiles = readdirSync(join(root, '.goldseam', 'heals'));
    expect(healFiles).toEqual(['cart-abc123-heal.json']);
  });

  it('dry-run proposes but leaves the spec untouched', async () => {
    const heal = await healArtifactFile(artifactPath, stubRunner([GOOD_REPLY]), makeOptions({ dryRun: true }));
    expect(heal.verdict).toBe('healed');
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toBe(SPEC);
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
