// The oracle rung: known-good aria identity as the impostor guard.
// Deliberately NO @vitest-environment jsdom — these run in plain Node,
// proving the CLI path (withDomGlobals + jsdom + the vendored aria walk)
// works without vitest's browser globals.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_HEAL_OPTIONS, healArtifactFile } from '../src/heal/engine';
import { withDomGlobals } from '../src/heal/dom-env';
import { oracleStage } from '../src/heal/stages';
import { HealContext, OracleEntry } from '../src/heal/types';
import { FailureArtifact } from '../src/shared/types';
import { stubRunner } from './helpers';

const SPEC_REL = 'cypress/e2e/cart.cy.ts';
const DOM = `<html><body>
  <header><span id="cart-count">0</span></header>
  <button id="add-to-cart">Add to cart</button>
  <button id="save-draft">Save draft</button>
  <div id="host"><template shadowrootmode="open"><button id="shadow-pay">Pay now</button></template></div>
</body></html>`;

const artifact = (overrides: Partial<FailureArtifact> = {}): FailureArtifact => ({
  schemaVersion: 1,
  title: 'adds',
  specPath: SPEC_REL,
  errorMessage: 'Expected to find element: `#add-to-basket`, but never found it.',
  url: 'http://localhost:4173/',
  domHtml: DOM,
  ariaSnapshot: '- button "Add to cart"',
  redacted: true,
  failedSelector: '#add-to-basket',
  ...overrides,
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'goldseam-oracle-'));
  mkdirSync(join(root, 'cypress', 'e2e'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const SPEC = `it('adds', () => {
  cy.visit('/');
  cy.get('#add-to-basket').click();
  cy.get('#cart-count').should('have.text', '1');
});
`;

function writeOracle(entries: OracleEntry[] | string): string {
  const file = join(root, 'oracle.json');
  writeFileSync(file, typeof entries === 'string' ? entries : JSON.stringify(entries));
  return file;
}

function makeCtx(
  newString: string,
  oracleFile: string | null,
  a: FailureArtifact = artifact(),
): HealContext {
  writeFileSync(join(root, a.specPath), SPEC);
  return {
    artifact: a,
    artifactPath: 'unused',
    options: {
      ...DEFAULT_HEAL_OPTIONS,
      projectRoot: root,
      healsDir: join(root, 'heals'),
      cacheFile: null,
      oracleFile,
    },
    runner: { id: 'none', repair: async () => '' },
    specSource: SPEC,
    proposal: {
      edits: [{ file: a.specPath, oldString: `cy.get('#add-to-basket')`, newString }],
      confidence: 0.9,
    },
    apply() {},
    revert() {},
  };
}

const IDENTITY: OracleEntry = { specPath: SPEC_REL, title: 'adds', role: 'button', name: 'Add to cart' };

function makeCtxWithSpec(newString: string, oracleFile: string | null, a: FailureArtifact, spec: string): HealContext {
  const ctx = makeCtx(newString, oracleFile, a);
  writeFileSync(join(root, a.specPath), spec);
  ctx.specSource = spec;
  return ctx;
}

describe('oracle stage (plain-Node — the CLI path)', () => {
  it('skips with evidence when no oracle file is configured', async () => {
    const v = await oracleStage.run(makeCtx(`cy.get('#add-to-cart')`, null));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/no known-good identity file/);
  });

  it('skips when the file has no entry for this test', async () => {
    const file = writeOracle([{ ...IDENTITY, title: 'some other test' }]);
    const v = await oracleStage.run(makeCtx(`cy.get('#add-to-cart')`, file));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/no known-good identity for this test/);
  });

  it('skips (with the reason) on a corrupt oracle file', async () => {
    const file = writeOracle('{not json');
    const v = await oracleStage.run(makeCtx(`cy.get('#add-to-cart')`, file));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/unreadable/);
  });

  it('passes when the healed selector targets the known-good identity', async () => {
    const file = writeOracle([IDENTITY]);
    const v = await oracleStage.run(makeCtx(`cy.get('#add-to-cart')`, file));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/targets the known-good button "Add to cart"/);
  });

  it('rejects an impostor: existing element, wrong identity', async () => {
    const file = writeOracle([IDENTITY]);
    const v = await oracleStage.run(makeCtx(`cy.get('#save-draft')`, file));
    expect(v.verdict).toBe('fail');
    expect(v.evidence).toMatch(/different element.*impostor guard/);
  });

  it('gives up when the known-good identity is gone from the capture', async () => {
    const file = writeOracle([{ ...IDENTITY, name: 'Buy it now' }]);
    const v = await oracleStage.run(makeCtx(`cy.get('#add-to-cart')`, file));
    expect(v.verdict).toBe('gave-up');
    expect(v.evidence).toMatch(/no longer exists in the capture/);
  });

  it('finds identities inside serialized shadow content', async () => {
    const file = writeOracle([{ ...IDENTITY, name: 'Pay now' }]);
    const v = await oracleStage.run(makeCtx(`cy.get('#shadow-pay')`, file));
    expect(v.verdict).toBe('pass');
    // evidence must prove the identity CHECK ran, not an oracle skip
    expect(v.evidence).toMatch(/targets the known-good button "Pay now"/);
  });

  it('judges the element a positional chain ACTS on, not "any match" (red-team)', async () => {
    // two .btn buttons: doc-order first is the impostor
    const dom = `<html><body>
      <button class="btn" id="save">Save draft</button>
      <button class="btn" id="add">Add to cart</button>
    </body></html>`;
    const file = writeOracle([IDENTITY]);
    const spec = `it('adds', () => {\n  cy.get('#add-to-basket').first().click();\n});\n`;
    const a = artifact({ domHtml: dom });
    const ctx = makeCtx(`cy.get('.btn')`, file, a);
    writeFileSync(join(root, SPEC_REL), spec);
    const v = await oracleStage.run(ctx); // .first() acts on #save — impostor
    expect(v.verdict).toBe('fail');

    const specEq = `it('adds', () => {\n  cy.get('#add-to-basket').eq(1).click();\n});\n`;
    writeFileSync(join(root, SPEC_REL), specEq);
    const v2 = await oracleStage.run(makeCtxWithSpec(`cy.get('.btn')`, file, a, specEq));
    expect(v2.verdict).toBe('pass'); // .eq(1) acts on #add — the real target
  });

  it('never blesses a selector that only matches by crossing a boundary (red-team)', async () => {
    // '#host #shadow-pay' crosses the serialized shadow boundary: the live
    // page (and boundary-respecting queries) resolve it to nothing.
    const file = writeOracle([{ ...IDENTITY, name: 'Pay now' }]);
    const v = await oracleStage.run(makeCtx(`cy.get('#host #shadow-pay')`, file));
    expect(v.verdict).toBe('fail');
    expect(v.evidence).toMatch(/matches nothing/);
  });

  it('judges cy.contains edits by the identity text', async () => {
    // a realistic contains heal edits the TEXT inside contains(), so the
    // spec must already use contains (a method swap would be rejected by
    // the validator long before the oracle sees it)
    const file = writeOracle([IDENTITY]);
    const spec = `it('adds', () => {\n  cy.contains('Buy it now').click();\n});\n`;
    const ctxFor = (text: string): HealContext => {
      const ctx = makeCtx(`unused`, file);
      writeFileSync(join(root, SPEC_REL), spec);
      ctx.specSource = spec;
      ctx.proposal = {
        edits: [{ file: SPEC_REL, oldString: `cy.contains('Buy it now')`, newString: `cy.contains('${text}')` }],
        confidence: 0.9,
      };
      return ctx;
    };
    const good = await oracleStage.run(ctxFor('Add to cart'));
    expect(good.verdict).toBe('pass');
    const bad = await oracleStage.run(ctxFor('Save draft'));
    expect(bad.verdict).toBe('fail');
  });
});

describe('engine with the oracle rung', () => {
  function scaffold(a: FailureArtifact): string {
    writeFileSync(join(root, SPEC_REL), SPEC);
    const failuresDir = join(root, '.goldseam', 'failures');
    mkdirSync(failuresDir, { recursive: true });
    const p = join(failuresDir, 'cart-abc123.json');
    writeFileSync(p, JSON.stringify(a));
    return p;
  }

  const reply = (newString: string) =>
    JSON.stringify({
      edits: [{ file: SPEC_REL, oldString: `cy.get('#add-to-basket')`, newString }],
      confidence: 0.9,
      reasoning: 'r',
    });

  it('an impostor proposal fails at oracle and feeds back; the model recovers', async () => {
    const p = scaffold(artifact());
    const file = writeOracle([IDENTITY]);
    const heal = await healArtifactFile(
      p,
      stubRunner([reply(`cy.get('#save-draft')`), reply(`cy.get('#add-to-cart')`)]),
      {
        ...DEFAULT_HEAL_OPTIONS,
        stages: ['triage', 'propose', 'resolve', 'oracle'],
        projectRoot: root,
        healsDir: join(root, '.goldseam', 'heals'),
        cacheFile: null,
        oracleFile: file,
      },
    );
    expect(heal.verdict).toBe('healed');
    expect(heal.attempts[0].ladder.map((r) => `${r.stage}:${r.verdict}`)).toEqual([
      'triage:pass',
      'propose:pass',
      'resolve:pass',
      'oracle:fail',
    ]);
    expect(heal.attempts[1].ladder.at(-1)).toMatchObject({ stage: 'oracle', verdict: 'pass' });
  });
});

describe('withDomGlobals', () => {
  it('installs and fully restores globals', () => {
    const g = globalThis as Record<string, unknown>;
    const before = { Element: g.Element, Node: g.Node };
    const result = withDomGlobals({ Element: 'fake-el', Node: 'fake-node' }, () => {
      expect(g.Element).toBe('fake-el');
      return 42;
    });
    expect(result).toBe(42);
    expect(g.Element).toBe(before.Element);
    expect(g.Node).toBe(before.Node);
    expect('Element' in g).toBe(before.Element !== undefined);
  });

  it('restores a PRE-EXISTING global to its prior value, not just deletes', () => {
    // plain-Node has no Element/Node, so without a sentinel only the
    // delete branch of the restore loop ever runs (test-red-team LOW)
    const g = globalThis as Record<string, unknown>;
    g.Element = 'prior-value';
    try {
      withDomGlobals({ Element: 'shimmed' }, () => {
        expect(g.Element).toBe('shimmed');
      });
      expect(g.Element).toBe('prior-value');
    } finally {
      delete g.Element;
    }
  });

  it('restores on throw', () => {
    const g = globalThis as Record<string, unknown>;
    expect(() =>
      withDomGlobals({ Node: 'x' }, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(g.Node).not.toBe('x');
  });
});
