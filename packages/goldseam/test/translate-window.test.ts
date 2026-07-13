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
 * past `budget`, so a head cut would drop it. Kept small enough (~60 KB) that
 * jsdom parses it well under vitest's 5s timeout on a cold CI runner, while
 * still exceeding every budget the tests use (max 20000). */
function bigPage(target: string, filler = 700): string {
  const noise = '<div class="chrome"><span>nav</span><span>header stuff</span></div>'.repeat(200);
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

  it('the Capitalized tier outranks a lowercase content word (isolates the middle rung)', () => {
    // "Save" is a capitalized label; "pricing" is a lowercase content word.
    // The capitalized pass must place Save AHEAD of pricing — deleting that
    // pass (leaving only quoted + content) would order them the other way.
    const a = stepAnchors(['open the pricing panel then Save the form']);
    expect(a.indexOf('Save')).toBeLessThan(a.indexOf('pricing'));
  });

  it('a quoted token in a later step outranks a capitalized token in an earlier one', () => {
    const a = stepAnchors(['Click the Login link', 'Type into the "Email address" field']);
    expect(a[0]).toBe('Email address'); // cross-step quoted precedence
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

  it('anchors on a form control whose label lives in a placeholder, not text', () => {
    const dom = bigPage('<input placeholder="Search the catalog" name="q">');
    const budget = 20000;
    const out = windowTranslationDom(dom, stepAnchors(['Type shoes into the search box']), budget);
    expect(out).toContain('goldseam: DOM windowed');
    expect(out).toContain('Search the catalog');
    expect(out.length).toBeLessThanOrEqual(budget);
  });

  it('anchors on aria-label too (not only placeholder)', () => {
    const dom = bigPage('<button aria-label="Add to Wishlist" class="i">♥</button>');
    const budget = 20000;
    const out = windowTranslationDom(dom, stepAnchors(['Click the Wishlist button']), budget);
    expect(out).toContain('goldseam: DOM windowed');
    expect(out).toContain('aria-label="Add to Wishlist"');
    expect(out.length).toBeLessThanOrEqual(budget);
  });
});

describe('windowTranslationDom — output is a hard ceiling (budget clamp)', () => {
  it('clamps when the anchor element itself exceeds the budget (body-truncation branch)', () => {
    // The anchor node's OWN outerHTML dwarfs the budget, so emitWindow cannot
    // climb and the body-trim + final clamp must fire. Mutation #2 (removing
    // the clamp) must fail here.
    const budget = 5000;
    const filler = '<div>zzz</div>'.repeat(1500); // ~21K of anchorless chrome
    const dom = `<body>${filler}<button data-testid="chk">Checkout ${'x'.repeat(9000)}</button></body>`;
    const out = windowTranslationDom(dom, stepAnchors(['Click the Checkout button']), budget);
    expect(out).toContain('goldseam: DOM windowed');
    expect(out).toContain('data-testid="chk"'); // the target attribute survives
    expect(out).toContain('Checkout'); // and the anchor text, at the head of the node
    expect(out.length).toBeLessThanOrEqual(budget); // clamp holds — would exceed without it
  });

  it('clamps when a deep attribute-heavy ancestor scaffold alone exceeds the budget', () => {
    // A tiny budget + a deeply nested anchor whose scaffold (open+close tags,
    // long class attrs) is larger than the whole budget. The body trims to 0
    // yet the scaffold would still blow the budget without the FINAL clamp
    // (prod red-team MEDIUM-1).
    const budget = 300;
    let inner = '<a data-testid="t">Pricing here</a>';
    for (let i = 0; i < 8; i++) inner = `<section class="${'c'.repeat(80)}">${inner}</section>`;
    const dom = `<body>${'<p>p</p>'.repeat(200)}<main>${inner}</main></body>`;
    const out = windowTranslationDom(dom, stepAnchors(['Click the Pricing link']), budget);
    expect(out.length).toBeLessThanOrEqual(budget); // hard ceiling, scaffold notwithstanding
  });

  it('every path stays within budget — gate, window, and no-anchor alike', () => {
    const budget = 8000;
    const cases: Array<[string, string[]]> = [
      ['<body><a>Login</a>' + '<p>x</p>'.repeat(20000) + '</body>', ['Click Login']], // gate
      [bigPage('<button data-testid="d">Deep Checkout</button>'), ['Click Checkout']], // window
      ['<div>no anchor here</div>'.repeat(9000), ['zzz-absent']], // no anchor
      ['', ['x']],
      ['<<<not html', ['x']],
    ];
    for (const [dom, steps] of cases) {
      const out = windowTranslationDom(dom, stepAnchors(steps), budget);
      expect(typeof out).toBe('string');
      expect(out.length).toBeLessThanOrEqual(budget + TRUNC.length); // never past the ceiling
    }
  });
});

const TRUNC = '\n<!-- truncated -->';

describe('translationDom — budget wiring', () => {
  it('sends the whole stripped body when under budget (no window, script/style stripped)', () => {
    const dom = '<html><head><title>t</title></head><body><script>evil()</script><style>x{}</style><button id="go">Go</button></body></html>';
    const out = translationDom(dom, { steps: ['Click Go'] });
    expect(out).toContain('id="go"');
    expect(out).not.toContain('evil()');
    expect(out).not.toContain('goldseam: DOM windowed');
  });

  it('the budget knob is load-bearing: default sends the page whole, a small budget windows it', () => {
    // ~27K page: under the 40000 default (sent whole, no window), over a 12000
    // budget (windowed). A differential assertion — mutation #5 (ignoring
    // opts.budget) makes the two outputs identical and must fail here.
    const bulk = '<div>content of the page body</div>'.repeat(750); // ~27K, < 40000
    const dom = `<body><nav>${bulk}</nav><button data-testid="deep-target">Open Settings</button></body>`;
    const whole = translationDom(dom, { steps: ['Click the Settings panel'] }); // default 40000
    const small = translationDom(dom, { budget: 12000, steps: ['Click the Settings panel'] });
    expect(whole).not.toContain('goldseam: DOM windowed'); // default holds it whole
    expect(whole).toContain('deep-target');
    expect(small).toContain('goldseam: DOM windowed'); // small budget windows
    expect(small).toContain('deep-target');
    expect(small.length).toBeLessThanOrEqual(12000);
    expect(whole.length).toBeGreaterThan(small.length); // the knob changes the output
    expect(DEFAULT_TRANSLATE_DOM_BUDGET).toBe(40_000);
  });

  it('resolves the target inside the emitted ancestor scaffold (valid queryable region)', () => {
    const dom = bigPage('<button data-testid="checkout-now">Proceed to Checkout</button>');
    const out = windowTranslationDom(dom, stepAnchors(['Click the Checkout button']), 20000);
    // The target sits inside its <main> scaffold — the scaffold's whole purpose
    // (a descendant selector written against it still resolves).
    expect(out).toMatch(/<main[^>]*>[\s\S]*data-testid="checkout-now"[\s\S]*<\/main>/);
  });
});
