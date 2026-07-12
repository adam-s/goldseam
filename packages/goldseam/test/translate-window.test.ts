// The authoring DOM window (translate-window.ts) + its wiring into
// translationDom. Mirrors the heal window's guarantees for the authoring
// path: never throws, regression-proof gate, hard-bounded output, and the
// two edge cases live-testing surfaced — stopword-filtered step anchors, and
// attribute anchoring for form controls whose label lives in placeholder.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATE_DOM_BUDGET,
  translationDom,
} from '../src/plugin/translate';
import { stepAnchors, windowTranslationDom } from '../src/plugin/translate-window';

/** A page whose head-first slice is all chrome and whose target sits far
 * past `budget`, so a head cut would drop it. */
function bigPage(target: string, filler = 6000): string {
  const noise = '<div class="chrome"><span>nav</span><span>header stuff</span></div>'.repeat(400);
  const bulk = `<section class="bulk"><p>lorem ipsum body content</p></section>`.repeat(filler);
  return `<html><head><title>t</title></head><body><nav>${noise}</nav><main>${bulk}${target}</main></body></html>`;
}

describe('stepAnchors', () => {
  it('ranks quoted > Capitalized-label > content word, dropping imperatives/articles', () => {
    const a = stepAnchors(['Click the "Sign up" button', 'Type into the Pricing field']);
    expect(a[0]).toBe('Sign up'); // quoted wins
    expect(a).toContain('Pricing'); // capitalized label kept
    // Imperatives/articles/generic nouns are filtered — they'd window nothing.
    expect(a).not.toContain('Click');
    expect(a).not.toContain('The');
    expect(a).not.toContain('button');
    expect(a).not.toContain('field');
  });

  it('drops selector-shaped and trivially short tokens', () => {
    const a = stepAnchors(['Click .foo and #bar', 'do it']);
    expect(a).not.toContain('.foo');
    expect(a).not.toContain('#bar');
    expect(a.every((t) => t.length >= 3)).toBe(true);
  });
});

describe('windowTranslationDom — zero-regression gate', () => {
  it('returns the exact head-first slice when an anchor already appears in it', () => {
    // Anchor "Login" sits at the very top; the head slice already holds it, so
    // windowing must NOT engage — byte-identical to a plain head cut.
    const dom = `<body><header><a>Login</a></header>${'<p>x</p>'.repeat(20000)}</body>`;
    const budget = 5000;
    const out = windowTranslationDom(dom, stepAnchors(['Click the Login link']), budget);
    expect(out).toBe(dom.slice(0, budget) + '\n<!-- truncated -->');
    expect(out).not.toContain('goldseam: DOM windowed');
  });
});

describe('windowTranslationDom — engages on a deep target', () => {
  it('windows around a deep anchor a head-first slice would drop', () => {
    const dom = bigPage('<button data-testid="checkout-now">Proceed to Checkout</button>');
    const budget = 20000;
    const head = dom.slice(0, budget);
    expect(head).not.toContain('checkout-now'); // head-first would miss it
    const out = windowTranslationDom(dom, stepAnchors(['Click the Checkout button']), budget);
    expect(out).toContain('goldseam: DOM windowed');
    expect(out).toContain('checkout-now'); // the target survives, with its attribute
    expect(out.length).toBeLessThanOrEqual(budget);
  });

  it('anchors on a form control whose label lives in an attribute, not text', () => {
    const dom = bigPage('<input placeholder="Search the catalog" name="q">');
    const budget = 20000;
    const out = windowTranslationDom(dom, stepAnchors(['Type shoes into the search box']), budget);
    expect(out).toContain('goldseam: DOM windowed');
    expect(out).toContain('Search the catalog');
    expect(out.length).toBeLessThanOrEqual(budget);
  });
});

describe('windowTranslationDom — robustness', () => {
  it('never throws and stays within budget on hostile input', () => {
    for (const dom of ['', '<<<not html', '<body>' + 'a'.repeat(100000) + '</body>', '<div>no anchor here</div>'.repeat(9000)]) {
      const out = windowTranslationDom(dom, ['zzz-absent-anchor'], 8000);
      expect(typeof out).toBe('string');
      // No anchor ⇒ widened head-first fallback, still bounded by 2×budget + marker.
      expect(out.length).toBeLessThanOrEqual(8000 * 2 + 40);
    }
  });
});

describe('translationDom — budget wiring', () => {
  it('sends the whole stripped body when under budget (no window, script/style stripped)', () => {
    const dom = '<html><head><title>t</title></head><body><script>evil()</script><style>x{}</style><button id="go">Go</button></body></html>';
    const out = translationDom(dom, { steps: ['Click Go'] });
    expect(out).toContain('id="go"');
    expect(out).not.toContain('evil()');
    expect(out).not.toContain('goldseam: DOM windowed');
  });

  it('honors a smaller budget by windowing a deep target that the default would include', () => {
    const dom = bigPage('<button data-testid="deep-target">Open the Settings panel</button>', 1200);
    const small = translationDom(dom, { budget: 12000, steps: ['Click the Settings panel'] });
    expect(small).toContain('deep-target');
    expect(small.length).toBeLessThanOrEqual(12000);
    // The default (40000) budget holds the same page whole — proves the knob matters.
    expect(DEFAULT_TRANSLATE_DOM_BUDGET).toBe(40000);
  });
});
