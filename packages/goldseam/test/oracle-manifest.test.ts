// The green-run identity manifest: harvest merge semantics and the
// oracle rung's selector-aware lookup (plain Node — CLI path).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeOracles, recordOracleEntries } from '../src/plugin/oracle';
import { oracleStage } from '../src/heal/stages';
import { DEFAULT_HEAL_OPTIONS } from '../src/heal/engine';
import { HealContext, OracleEntry } from '../src/heal/types';
import { FailureArtifact } from '../src/shared/types';

describe('mergeOracles', () => {
  const payload = {
    specPath: 'a.cy.ts',
    title: 'adds',
    entries: [{ selector: '#buy', role: 'button', name: 'Buy' }],
  };

  it('last write wins per (spec, title, selector)', () => {
    const existing: OracleEntry[] = [
      { specPath: 'a.cy.ts', title: 'adds', selector: '#buy', role: 'button', name: 'OLD' },
      { specPath: 'a.cy.ts', title: 'adds', selector: '#other', role: 'link', name: 'Keep' },
    ];
    const merged = mergeOracles(existing, payload);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.selector === '#buy')?.name).toBe('Buy');
  });

  it('never touches hand-written test-level entries (no selector)', () => {
    const existing: OracleEntry[] = [{ specPath: 'a.cy.ts', title: 'adds', role: 'button', name: 'Manual' }];
    const merged = mergeOracles(existing, payload);
    expect(merged.find((e) => e.selector === undefined)?.name).toBe('Manual');
  });

  it('recordOracleEntries survives a corrupt manifest and writes atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goldseam-oracle-file-'));
    const file = join(dir, '.goldseam', 'oracle.json');
    mkdirSync(join(dir, '.goldseam'), { recursive: true });
    writeFileSync(file, '{corrupt');
    expect(recordOracleEntries(file, payload)).toBeNull();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('oracle rung selector preference', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'goldseam-oracle-pref-'));
    mkdirSync(join(root, 'cypress', 'e2e'), { recursive: true });
    writeFileSync(join(root, 'cypress/e2e/cart.cy.ts'), `it('adds', () => {\n  cy.get('#add-to-basket').click();\n});\n`);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const DOM = `<html><body><button id="add-to-cart">Add to cart</button><button id="save">Save draft</button></body></html>`;

  function ctx(entries: OracleEntry[], newString: string): HealContext {
    const file = join(root, 'oracle.json');
    writeFileSync(file, JSON.stringify(entries));
    const artifact: FailureArtifact = {
      schemaVersion: 1, title: 'adds', specPath: 'cypress/e2e/cart.cy.ts',
      errorMessage: 'Expected to find element: `#add-to-basket`, but never found it.',
      url: 'http://x/', domHtml: DOM, ariaSnapshot: '', redacted: true,
      failedSelector: '#add-to-basket',
    };
    return {
      artifact, artifactPath: 'unused',
      options: { ...DEFAULT_HEAL_OPTIONS, projectRoot: root, healsDir: join(root, 'heals'), cacheFile: null, oracleFile: file },
      runner: { id: 'none', repair: async () => '' },
      specSource: `it('adds', () => {\n  cy.get('#add-to-basket').click();\n});\n`,
      proposal: { edits: [{ file: artifact.specPath, oldString: `cy.get('#add-to-basket')`, newString }], confidence: 0.9 },
      apply() {}, revert() {},
    };
  }

  it("uses the BROKEN selector's harvested identity, not another selector's", async () => {
    const entries: OracleEntry[] = [
      { specPath: 'cypress/e2e/cart.cy.ts', title: 'adds', selector: '#cart-count', role: 'status', name: 'Count' },
      { specPath: 'cypress/e2e/cart.cy.ts', title: 'adds', selector: '#add-to-basket', role: 'button', name: 'Add to cart' },
    ];
    const good = await oracleStage.run(ctx(entries, `cy.get('#add-to-cart')`));
    expect(good.verdict).toBe('pass');
    const impostor = await oracleStage.run(ctx(entries, `cy.get('#save')`));
    expect(impostor.verdict).toBe('fail');
  });

  it('falls back to a hand-written test-level entry when no selector matches', async () => {
    const entries: OracleEntry[] = [
      { specPath: 'cypress/e2e/cart.cy.ts', title: 'adds', role: 'button', name: 'Add to cart' },
    ];
    const v = await oracleStage.run(ctx(entries, `cy.get('#add-to-cart')`));
    expect(v.verdict).toBe('pass');
  });
});
