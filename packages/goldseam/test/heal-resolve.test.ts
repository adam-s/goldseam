// The disambiguation guards (.agents/reference/disambiguation.md): triage (is this a
// selector break at all?), resolve (does the healed selector land on
// exactly the intended element in the DOM the model saw?), and the
// weak-assertion review flag. Pure functions + stages + engine wiring.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_HEAL_OPTIONS, healArtifactFile } from '../src/heal/engine';
import {
  assertionsAfter,
  countSelectorMatches,
  countTextMatches,
  directGetParentFor,
  healedSiteForEdit,
  impliesCollection,
  isWeaklyAsserted,
  reviewFlagsFor,
  scopedChildCount,
  stringSiteAt,
} from '../src/heal/resolve';
import { resolveStage, triageStage } from '../src/heal/stages';
import { HealContext, HealOptions } from '../src/heal/types';
import { FailureArtifact } from '../src/shared/types';
import { stubRunner } from './helpers';

const DOM = `<html><body>
  <header id="site-header"><span id="cart-count">0</span></header>
  <button id="add-to-cart" data-testid="add-to-cart">Add to cart</button>
  <ul><li class="item">Mug</li><li class="item">Plate</li><li class="item">Bowl</li></ul>
  <div id="host"><template shadowrootmode="open"><button class="shadow-buy">Buy</button></template></div>
</body></html>`;

const artifact = (overrides: Partial<FailureArtifact> = {}): FailureArtifact => ({
  schemaVersion: 1,
  title: 'adds',
  specPath: 'cypress/e2e/cart.cy.ts',
  errorMessage: 'Expected to find element: `#add-to-basket`, but never found it.',
  url: 'http://localhost:4173/',
  domHtml: DOM,
  ariaSnapshot: '- button "Add to cart"',
  redacted: true,
  failedSelector: '#add-to-basket',
  ...overrides,
});

describe('countSelectorMatches', () => {
  it('counts exact CSS matches', () => {
    expect(countSelectorMatches(DOM, '#add-to-cart', 'none')).toMatchObject({ count: 1, approximate: false });
    expect(countSelectorMatches(DOM, '.item', 'none')).toMatchObject({ count: 3, approximate: false });
    expect(countSelectorMatches(DOM, '#nope', 'none')).toMatchObject({ count: 0, approximate: false });
  });

  it('descends into declarative shadow templates', () => {
    expect(countSelectorMatches(DOM, '.shadow-buy', 'none')).toMatchObject({ count: 1, approximate: false });
  });

  it('returns null for jQuery-only selectors without stripping', () => {
    expect(countSelectorMatches(DOM, '.item:visible', 'none')).toBeNull();
  });

  it("strips state pseudo-classes in 'state' mode, marked approximate", () => {
    expect(countSelectorMatches(DOM, '.item:visible', 'state')).toMatchObject({ count: 3, approximate: true });
    // content filters are NOT strippable in state mode — the text may be the drift
    expect(countSelectorMatches(DOM, 'li:contains("Mug")', 'state')).toBeNull();
  });

  it("strips content/position filters only in 'all' mode", () => {
    expect(countSelectorMatches(DOM, 'li:contains("Mug")', 'all')).toMatchObject({ count: 3, approximate: true });
    expect(countSelectorMatches(DOM, '.item:eq(1)', 'all')).toMatchObject({ count: 3, approximate: true });
    expect(countSelectorMatches(DOM, '.item:first', 'all')).toMatchObject({ count: 3, approximate: true });
  });

  it('does not confuse :first with :first-child', () => {
    expect(countSelectorMatches(DOM, '.item:first-child', 'all')).toMatchObject({ count: 1, approximate: false });
  });

  it('returns null when stripping leaves nothing', () => {
    expect(countSelectorMatches(DOM, ':visible', 'all')).toBeNull();
  });
});

describe('countTextMatches', () => {
  it('yields the deepest elements containing the text', () => {
    expect(countTextMatches(DOM, 'Mug')).toBe(1); // the <li>, not ul/body/html
    expect(countTextMatches(DOM, 'Add to cart')).toBe(1);
    expect(countTextMatches(DOM, 'Checkout')).toBe(0);
  });

  it('sees text inside open shadow templates', () => {
    expect(countTextMatches(DOM, 'Buy')).toBe(1);
  });
});

describe('stringSiteAt / healedSiteForEdit', () => {
  const SPEC = `describe('cart', () => {
  // don't trip on this apostrophe
  it('adds', () => {
    cy.visit('/');
    cy.get('#add-to-basket', { timeout: 2000 }).click();
    cy.get('#cart-count').should('have.text', '1');
  });
});
`;

  it('locates the quoted string and its wrapping call, comment-aware', () => {
    const idx = SPEC.indexOf('#add-to-basket');
    const site = stringSiteAt(SPEC, idx);
    expect(site?.value).toBe('#add-to-basket');
    expect(site?.call).toBe('get');
  });

  it('returns null outside any string', () => {
    expect(stringSiteAt(SPEC, SPEC.indexOf('timeout'))).toBeNull();
  });

  it('extracts the healed selector from a quoted edit', () => {
    const healed = healedSiteForEdit(SPEC, {
      file: 'x',
      oldString: `cy.get('#add-to-basket', { timeout: 2000 })`,
      newString: `cy.get('#add-to-cart', { timeout: 2000 })`,
    });
    expect(healed?.site.value).toBe('#add-to-cart');
    expect(healed?.site.call).toBe('get');
  });

  it('extracts from a bare-string (cache-tier) edit', () => {
    const healed = healedSiteForEdit(SPEC, { file: 'x', oldString: '#add-to-basket', newString: '#add-to-cart' });
    expect(healed?.site.value).toBe('#add-to-cart');
  });

  it('keeps inner attribute-selector quotes inside the site value', () => {
    const spec = `cy.get('[data-testid="buy"]').click();`;
    const healed = healedSiteForEdit(spec, {
      file: 'x',
      oldString: `'[data-testid="buy"]'`,
      newString: `'[data-testid="add"]'`,
    });
    expect(healed?.site.value).toBe('[data-testid="add"]');
  });
});

describe('impliesCollection', () => {
  const at = (src: string) => src.indexOf(')');
  it('detects collection chains', () => {
    expect(impliesCollection(`cy.get('.item').first().click();`, at(`cy.get('.item')`))).toBe(true);
    expect(impliesCollection(`cy.get('.item').should('have.length', 3);`, 15)).toBe(true);
    expect(impliesCollection(`cy.get('.item').each(() => {});`, 15)).toBe(true);
  });
  it('a bare click expects one element', () => {
    expect(impliesCollection(`cy.get('.item').click();`, 15)).toBe(false);
  });
});

describe('selectorOccursInCode', () => {
  it('sees selectors in string literals, not in comments (proving-campaign)', async () => {
    const { selectorOccursInCode } = await import('../src/heal/resolve');
    const healed = `// culture note: #loginButton was the old id\ncy.get('[aria-label="Login"]').click();`;
    expect(selectorOccursInCode(healed, '#loginButton')).toBe(false);
    const unhealed = `cy.get('#loginButton').click();`;
    expect(selectorOccursInCode(unhealed, '#loginButton')).toBe(true);
  });
});

describe('assertion strength', () => {
  it('collects assertions to the end of the enclosing test only', () => {
    const spec = `it('a', () => {
    cy.get('#x').click();
    cy.get('#y').should('be.visible');
  });
  it('b', () => {
    cy.get('#z').should('have.text', 'strong');
  });`;
    const found = assertionsAfter(spec, spec.indexOf('.click()'));
    expect(found).toEqual(['be.visible']);
    expect(isWeaklyAsserted(found)).toBe(true);
  });

  it('a downstream strong assertion makes the heal behaviorally constrained', () => {
    const spec = `cy.get('#x').click();\ncy.get('#count').should('have.text', '1');`;
    expect(isWeaklyAsserted(assertionsAfter(spec, spec.indexOf('.click()')))).toBe(false);
  });

  it('no assertions at all is weak (action-only)', () => {
    expect(isWeaklyAsserted([])).toBe(true);
  });

  it('hook heals count the whole suite as the assertion window (proving-campaign)', () => {
    const spec = `describe('todos', () => {
  beforeEach(() => { cy.get('#old-input').type('x{enter}'); });
  it('a', () => { cy.get('#list li').should('have.length', 1); });
});`;
    const edit = { file: 'x', oldString: `cy.get('#old-input')`, newString: `cy.get('#new-input')` };
    // per-test window (non-hook): sees no assertions before the next it( → weak
    expect(reviewFlagsFor(spec, [edit])).toHaveLength(1);
    // hook window: the gated test's have.length counts → not weak
    expect(reviewFlagsFor(spec, [edit], { hookHeal: true })).toEqual([]);
  });

  it('reviewFlagsFor flags an all-weak heal and stays silent otherwise', () => {
    const weak = `it('a', () => { cy.get('#old').click(); });`;
    const strong = `it('a', () => { cy.get('#old').click(); cy.get('#c').should('have.text', '1'); });`;
    const edit = { file: 'x', oldString: `cy.get('#old')`, newString: `cy.get('#new')` };
    expect(reviewFlagsFor(weak, [edit])[0]).toMatch(/^weak-assertions:/);
    expect(reviewFlagsFor(strong, [edit])).toEqual([]);
  });
});

// ── stages ──────────────────────────────────────────────────────────────

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'goldseam-resolve-'));
  mkdirSync(join(root, 'cypress', 'e2e'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeCtx(spec: string, a: FailureArtifact, proposalEdits?: Array<{ oldString: string; newString: string }>): HealContext {
  writeFileSync(join(root, a.specPath), spec);
  return {
    artifact: a,
    artifactPath: 'unused',
    options: { ...DEFAULT_HEAL_OPTIONS, projectRoot: root, healsDir: join(root, 'heals'), cacheFile: null },
    runner: { id: 'none', repair: async () => '' },
    specSource: spec,
    proposal: proposalEdits && {
      edits: proposalEdits.map((e) => ({ file: a.specPath, ...e })),
      confidence: 0.9,
    },
    apply() {},
    revert() {},
  };
}

describe('triage stage', () => {
  it('gives up when the "missing" selector still matches the captured DOM (timing, not drift)', async () => {
    const a = artifact({
      errorMessage: 'Expected to find element: `#add-to-cart`, but never found it.',
      failedSelector: '#add-to-cart',
    });
    const v = await triageStage.run(makeCtx('', a));
    expect(v.verdict).toBe('gave-up');
    expect(v.evidence).toMatch(/still matches 1 element/);
  });

  it('passes when the selector is confirmed absent', async () => {
    const v = await triageStage.run(makeCtx('', artifact()));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/confirmed absent/);
  });

  it('gives up on a present-but-hidden :visible selector (state, not drift)', async () => {
    const a = artifact({ failedSelector: '.item:visible' });
    const v = await triageStage.run(makeCtx('', a));
    expect(v.verdict).toBe('gave-up');
    expect(v.evidence).toMatch(/state pseudo-classes/);
  });

  it('skips scoped (.find/.within) failures — a global count would lie', async () => {
    const a = artifact({
      errorMessage:
        'Expected to find element: `.item`, but never found it. Queried from element: <div#empty>',
      failedSelector: '.item', // exists globally, but the parent scope was empty
    });
    const v = await triageStage.run(makeCtx('', a));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/scoped/);
  });

  it('names frame-scoping, not timing, when the match lives only in an iframe (red-team)', async () => {
    const dom = '<html><body><iframe></iframe><template data-frame-content><button class="pay-btn">Pay</button></template></body></html>';
    const a = artifact({ domHtml: dom, failedSelector: '.pay-btn' });
    const v = await triageStage.run(makeCtx('', a));
    expect(v.verdict).toBe('gave-up');
    expect(v.evidence).toMatch(/only inside a same-origin iframe/);
    expect(v.evidence).not.toMatch(/timing/);
  });

  it('skips selectors it cannot statically check', async () => {
    const a = artifact({ failedSelector: 'li:contains("Gone")' });
    const v = await triageStage.run(makeCtx('', a));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/not statically checkable/);
  });

  it('passes when no selector was parsed from the error', async () => {
    const v = await triageStage.run(makeCtx('', artifact({ failedSelector: undefined })));
    expect(v.verdict).toBe('pass');
  });
});

describe('resolve stage', () => {
  const SPEC = `it('adds', () => {
  cy.visit('/');
  cy.get('#add-to-basket').click();
  cy.get('#cart-count').should('have.text', '1');
});
`;

  it('rejects a healed selector that matches nothing (hallucination)', async () => {
    const ctx = makeCtx(SPEC, artifact(), [
      { oldString: `cy.get('#add-to-basket')`, newString: `cy.get('#does-not-exist')` },
    ]);
    const v = await resolveStage.run(ctx);
    expect(v.verdict).toBe('fail');
    expect(v.evidence).toMatch(/matches nothing/);
  });

  it('rejects an ambiguous healed selector when the chain expects one element', async () => {
    const ctx = makeCtx(SPEC, artifact(), [
      { oldString: `cy.get('#add-to-basket')`, newString: `cy.get('.item')` },
    ]);
    const v = await resolveStage.run(ctx);
    expect(v.verdict).toBe('fail');
    expect(v.evidence).toMatch(/ambiguous.*3 elements/);
  });

  it('accepts a multi-match selector when the chain works on a collection', async () => {
    const spec = `it('lists', () => {\n  cy.get('.itm').should('have.length', 3);\n});\n`;
    const ctx = makeCtx(spec, artifact(), [{ oldString: `cy.get('.itm')`, newString: `cy.get('.item')` }]);
    const v = await resolveStage.run(ctx);
    expect(v.verdict).toBe('pass');
  });

  it('accepts a unique healed selector, including into open shadow roots', async () => {
    const ctx = makeCtx(SPEC, artifact(), [
      { oldString: `cy.get('#add-to-basket')`, newString: `cy.get('.shadow-buy')` },
    ]);
    const v = await resolveStage.run(ctx);
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/1 match/);
  });

  it('judges cy.contains by page text: absent fails, present passes', async () => {
    const spec = `it('adds', () => {\n  cy.contains('Buy now').click();\n});\n`;
    const bad = await resolveStage.run(
      makeCtx(spec, artifact(), [{ oldString: `cy.contains('Buy now')`, newString: `cy.contains('Purchase')` }]),
    );
    expect(bad.verdict).toBe('fail');
    expect(bad.evidence).toMatch(/matches no element text/);

    const good = await resolveStage.run(
      makeCtx(spec, artifact(), [{ oldString: `cy.contains('Buy now')`, newString: `cy.contains('Add to cart')` }]),
    );
    expect(good.verdict).toBe('pass');
  });

  it('rejects a .find() ambiguity within a uniquely-resolved parent (scoped uniqueness)', async () => {
    // Was existence-only (deferred): `.find('.item')` matches all 3 <li> inside
    // the single <ul>, and `.should('have.text', 'Mug')` expects one element —
    // a look-alike-sibling ambiguity now caught offline instead of punted.
    const spec = `it('adds', () => {\n  cy.get('ul').find('.itm').should('have.text', 'Mug');\n});\n`;
    const ctx = makeCtx(spec, artifact(), [{ oldString: `.find('.itm')`, newString: `.find('.item')` }]);
    const v = await resolveStage.run(ctx);
    expect(v.verdict).toBe('fail');
    expect(v.evidence).toMatch(/ambiguous within its parent scope — 3 matches inside the single "ul"/);
  });

  it('defers selectors it cannot statically check to the rerun rungs', async () => {
    const spec = `it('adds', () => {\n  cy.get('#a').click();\n});\n`;
    const ctx = makeCtx(spec, artifact(), [{ oldString: `cy.get('#a')`, newString: `cy.get('#b:has(svg)')` }]);
    const v = await resolveStage.run(ctx);
    // jsdom may or may not support :has — either an exact count or a deferral, never a throw
    expect(['pass', 'fail']).toContain(v.verdict);
  });

  it('notes frame-only healed matches instead of failing them (frame-entry helpers exist)', async () => {
    const dom = '<html><body><iframe></iframe><template data-frame-content><button class="pay-btn">Pay</button></template></body></html>';
    const spec = `it('pays', () => {\n  cy.get('#old-btn').click();\n});\n`;
    const ctx = makeCtx(spec, artifact({ domHtml: dom }), [
      { oldString: `cy.get('#old-btn')`, newString: `cy.get('.pay-btn')` },
    ]);
    const v = await resolveStage.run(ctx);
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/inside iframe content/);
  });

  it('passes through when there are no edits (give-up upstream)', async () => {
    const v = await resolveStage.run(makeCtx(SPEC, artifact()));
    expect(v.verdict).toBe('pass');
  });
});

// ── engine wiring ───────────────────────────────────────────────────────

describe('engine with the offline guard rungs', () => {
  const SPEC_REL = 'cypress/e2e/cart.cy.ts';
  const SPEC = `it('adds', () => {
  cy.visit('/');
  cy.get('#add-to-basket').click();
  cy.get('#cart-count').should('have.text', '1');
});
`;

  function scaffold(a: FailureArtifact, spec = SPEC): string {
    writeFileSync(join(root, SPEC_REL), spec);
    const failuresDir = join(root, '.goldseam', 'failures');
    mkdirSync(failuresDir, { recursive: true });
    const p = join(failuresDir, 'cart-abc123.json');
    writeFileSync(p, JSON.stringify(a));
    return p;
  }

  const options = (): HealOptions => ({
    ...DEFAULT_HEAL_OPTIONS,
    stages: ['triage', 'propose', 'resolve'],
    projectRoot: root,
    healsDir: join(root, '.goldseam', 'heals'),
    cacheFile: null,
  });

  const reply = (newString: string) =>
    JSON.stringify({
      edits: [{ file: SPEC_REL, oldString: `cy.get('#add-to-basket')`, newString }],
      confidence: 0.9,
      reasoning: 'r',
    });

  it('triage give-up costs zero model calls', async () => {
    // The spec must actually USE the failed selector (a real capture always
    // does — the test failed on it); otherwise the engine's stale-capture
    // guard fires first.
    const p = scaffold(
      artifact({ failedSelector: '#add-to-cart', errorMessage: 'Expected to find element: `#add-to-cart`, but never found it.' }),
      SPEC.replace('#add-to-basket', '#add-to-cart'),
    );
    const runner = stubRunner([reply(`cy.get('#whatever')`)]);
    const heal = await healArtifactFile(p, runner, options());
    expect(heal.verdict).toBe('gave-up');
    expect(runner.calls).toBe(0);
    expect(heal.attempts[0].ladder[0].stage).toBe('triage');
  });

  it('resolve rejection feeds back and the model recovers on attempt 2', async () => {
    const p = scaffold(artifact());
    const runner = stubRunner([reply(`cy.get('#hallucinated')`), reply(`cy.get('#add-to-cart')`)]);
    const heal = await healArtifactFile(p, runner, options());
    expect(heal.verdict).toBe('healed');
    expect(heal.attempts).toHaveLength(2);
    expect(heal.attempts[0].ladder.map((r) => `${r.stage}:${r.verdict}`)).toEqual([
      'triage:pass',
      'propose:pass',
      'resolve:fail',
    ]);
    expect(readFileSync(join(root, SPEC_REL), 'utf8')).toContain('#add-to-cart');
  });

  it('a healed test with only weak assertions carries a review flag', async () => {
    const weakSpec = `it('adds', () => {\n  cy.visit('/');\n  cy.get('#add-to-basket').click();\n});\n`;
    const p = scaffold(artifact(), weakSpec);
    const heal = await healArtifactFile(p, stubRunner([reply(`cy.get('#add-to-cart')`)]), options());
    expect(heal.verdict).toBe('healed');
    expect(heal.reviewFlags?.[0]).toMatch(/^weak-assertions:/);
  });

  it('a downstream strong assertion suppresses the flag', async () => {
    const p = scaffold(artifact());
    const heal = await healArtifactFile(p, stubRunner([reply(`cy.get('#add-to-cart')`)]), options());
    expect(heal.verdict).toBe('healed');
    expect(heal.reviewFlags).toBeUndefined();
  });
});

describe('scoped .find() uniqueness (helpers)', () => {
  it('directGetParentFor recovers ONLY the direct cy.get(P).find(<site>) parent', () => {
    const at = (src: string, needle: string) => src.indexOf(needle);
    const s1 = `cy.get('.cart').find('.line-item')`;
    expect(directGetParentFor(s1, at(s1, `'.line-item'`))).toBe('.cart');
    // chained parent (.find().find()) → not soundly resolvable → null
    const s2 = `cy.get('.page').find('.cart').find('.line-item')`;
    expect(directGetParentFor(s2, at(s2, `'.line-item'`))).toBeNull();
    // .within() block / variable subject → null
    const s3 = `cy.get('.cart').within(() => { cy.get('.line-item'); })`;
    expect(directGetParentFor(s3, at(s3, `'.line-item'`))).toBeNull();
  });

  it('scopedChildCount counts WITHIN a uniquely-resolved parent, else defers (null)', () => {
    const cart = (kids: string) => `<html><body><div class="cart">${kids}</div></body></html>`;
    expect(scopedChildCount(cart('<a class="li">1</a><a class="li">2</a><a class="li">3</a>'), '.cart', '.li')).toEqual({ count: 3 });
    expect(scopedChildCount(cart('<a class="li">1</a>'), '.cart', '.li')).toEqual({ count: 1 });
    // ambiguous parent (2 carts) → null (defer)
    expect(scopedChildCount('<div class="cart"><a class="li">1</a></div><div class="cart"></div>', '.cart', '.li')).toBeNull();
    // absent parent → null
    expect(scopedChildCount(cart('<a class="li">1</a>'), '.nope', '.li')).toBeNull();
    // jQuery-pseudo child → null (an over-approximation must never reject)
    expect(scopedChildCount(cart('<a class="li">1</a><a class="li">2</a>'), '.cart', '.li:visible')).toBeNull();
    // descends a shadow template inside the parent
    const shadow = '<html><body><div class="cart"><div><template shadowrootmode="open"><a class="li">s1</a><a class="li">s2</a></template></div></div></body></html>';
    expect(scopedChildCount(shadow, '.cart', '.li')).toEqual({ count: 2 });
  });
});

describe('resolve stage — scoped .find() uniqueness', () => {
  const scopedCtx = (domHtml: string, chain: string) =>
    makeCtx(`it('t', () => { ${chain} });`, artifact({ domHtml }), [{ oldString: `'.old'`, newString: `'.li'` }]);
  const findChain = "cy.get('.cart').find('.old').should('exist');";

  it('REJECTS a look-alike-sibling ambiguity within a uniquely-resolved parent', async () => {
    const dom = '<html><body><div class="cart"><a class="li">1</a><a class="li">2</a><a class="li">3</a></div></body></html>';
    const v = await resolveStage.run(scopedCtx(dom, findChain));
    expect(v.verdict).toBe('fail');
    expect(v.evidence).toMatch(/ambiguous within its parent scope — 3 matches inside the single "\.cart"/);
  });

  it('PASSES when the child is unique within the parent (real uniqueness, not just existence)', async () => {
    const dom = '<html><body><div class="cart"><a class="li">only</a></div></body></html>';
    const v = await resolveStage.run(scopedCtx(dom, findChain));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/unique within "\.cart" \(scoped uniqueness verified\)/);
  });

  it('SOUNDNESS: 3 matches document-wide but 1 within the parent → PASS (a global count would false-reject)', async () => {
    const dom = '<html><body><div class="cart"><a class="li">in</a></div><a class="li">out1</a><a class="li">out2</a></body></html>';
    // whole-document count is 3 — the old existence-only behavior, and a naive
    // global-ambiguity check, would both mishandle this.
    expect(countSelectorMatches(dom, '.li', 'all')?.count).toBe(3); // '.li' is the healed value
    const v = await resolveStage.run(scopedCtx(dom, findChain));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/unique within "\.cart"/);
  });

  it('SOUNDNESS: ambiguous PARENT (two .cart) → defer to rerun (existence only), never a false reject', async () => {
    const dom = '<html><body><div class="cart"><a class="li">a</a><a class="li">b</a></div><div class="cart"><a class="li">c</a></div></body></html>';
    const v = await resolveStage.run(scopedCtx(dom, findChain));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/scoped call — existence only/);
  });

  it('SOUNDNESS: a collection chain (.first()) makes multiple matches legitimate → PASS', async () => {
    const dom = '<html><body><div class="cart"><a class="li">1</a><a class="li">2</a><a class="li">3</a></div></body></html>';
    const v = await resolveStage.run(scopedCtx(dom, "cy.get('.cart').find('.old').first().click();"));
    expect(v.verdict).toBe('pass');
  });

  it('SOUNDNESS: a chained/non-direct parent defers (existence only)', async () => {
    const dom = '<html><body><div class="page"><div class="cart"><a class="li">1</a><a class="li">2</a></div></div></body></html>';
    const v = await resolveStage.run(scopedCtx(dom, "cy.get('.page').find('.cart').find('.old').should('exist');"));
    expect(v.verdict).toBe('pass');
    expect(v.evidence).toMatch(/scoped call — existence only/);
  });
});
