// rank.ts — the offline candidate scorer that produces the model's shortlist.
// These pin the load-bearing behaviors: the renamed match-many target ranks
// into the shortlist with a usable text sample, non-content (<style>/<script>)
// is never a candidate, and it never throws.

import { describe, expect, it } from 'vitest';
import { rankCandidates, readIntent } from '../src/heal/rank';

// A Squarespace-shaped capture AFTER the break: a repeated nav, inlined <style>
// blobs in the body, and a card list where `.summary-title-link` was renamed to
// `.summary-title-link-next` — the cards carry many sibling classes too.
function blogCapture(): string {
  const nav = Array.from({ length: 8 }, (_, i) => `<a class="header-nav-item">Nav ${i}</a>`).join('');
  const styleNoise = '<style>.x{color:red} .summary-title-link-next{font:bold}</style>'.repeat(6);
  const cards = Array.from({ length: 21 }, (_, i) =>
    `<div class="summary-item summary-item-has-thumbnail">` +
    `<time class="summary-metadata">June 2, 2026</time>` +
    `<a class="summary-title-link-next"><span class="summary-title">Post Title ${i} Words</span></a>` +
    `</div>`,
  ).join('');
  return `<html><body><nav>${styleNoise}${nav}</nav><main>${styleNoise}${cards}</main></body></html>`;
}

const SPEC =
  "cy.get('.summary-title-link').should('have.length.at.least', 5);\n" +
  "cy.get('.summary-title-link').first().invoke('text').should('match', /\\w+/);";

describe('readIntent', () => {
  it('mines minCount, text pattern, and broken-selector tokens from the spec', () => {
    const i = readIntent({ failedSelector: '.summary-title-link', specSource: SPEC, domHtml: '' });
    expect(i.minCount).toBe(5);
    expect(i.textPattern?.source).toBe('\\w+');
    expect(i.brokenTokens).toContain('summary-title-link');
    expect(i.culture).toBe('class');
  });

  it('reads an attribute culture and a contains() anchor', () => {
    const i = readIntent({
      failedSelector: '[data-testid="add-to-cart"]',
      specSource: "cy.contains('Add to cart'); cy.get('[data-testid=\"add-to-cart\"]')",
      domHtml: '',
    });
    expect(i.culture).toBe('attr');
    expect(i.anchorTexts).toContain('Add to cart');
  });
});

describe('rankCandidates — match-many rename', () => {
  const cands = rankCandidates({ failedSelector: '.summary-title-link', specSource: SPEC, domHtml: blogCapture() }, 8);

  it('ranks the renamed target into the shortlist, at the top', () => {
    const idx = cands.findIndex((c) => c.selector === '.summary-title-link-next');
    expect(idx).toBeGreaterThanOrEqual(0); // present
    expect(idx).toBeLessThan(2); // near the top (rename has the strongest name overlap)
  });

  it('gives the target a usable text sample the model can disambiguate on', () => {
    const target = cands.find((c) => c.selector === '.summary-title-link-next')!;
    expect(target.count).toBe(21); // matches the whole list
    expect(target.sampleText).toContain('Post Title'); // the title, not the date
    expect(target.score).toBeGreaterThan(0.8);
  });

  it('NEVER makes <style>/<script> a candidate even though its text matches /\\w+/', () => {
    // the style blob contains ".summary-title-link-next" as CSS text — must not
    // become a candidate element, and no candidate may be a <style> match.
    for (const c of cands) {
      const els = c.selector; // sanity: selectors are class/attr/id, never a tag
      expect(els).toMatch(/^[.#[]/);
    }
    // the nav's repeated class is allowed as a candidate but ranks below the target
    const navIdx = cands.findIndex((c) => c.selector === '.header-nav-item');
    const tgtIdx = cands.findIndex((c) => c.selector === '.summary-title-link-next');
    if (navIdx >= 0) expect(tgtIdx).toBeLessThan(navIdx);
  });

  it('is a fraction of the DOM size — the point of the shortlist', () => {
    const shortlistChars = cands.map((c) => `${c.selector} (${c.count}) ${c.sampleText}`).join('\n').length;
    expect(shortlistChars).toBeLessThan(blogCapture().length / 3);
  });
});

describe('rankCandidates — robustness', () => {
  it('never throws on hostile input and returns an array', () => {
    for (const dom of ['', '<div', '<html></html>', 'plain text', '<body>' + '<div>'.repeat(500)]) {
      expect(() => rankCandidates({ failedSelector: '.x', specSource: '', domHtml: dom })).not.toThrow();
      expect(Array.isArray(rankCandidates({ specSource: '', domHtml: dom }))).toBe(true);
    }
  });

  it('surfaces a testid/id anchor candidate on a single-target page', () => {
    const dom = '<body><button data-testid="checkout-now">Checkout</button><div id="cart-total">$9</div></body>';
    const cands = rankCandidates({ failedSelector: '[data-testid="checkout"]', specSource: "cy.contains('Checkout')", domHtml: dom });
    expect(cands.some((c) => c.selector === '[data-testid=checkout-now]')).toBe(true);
  });
});
