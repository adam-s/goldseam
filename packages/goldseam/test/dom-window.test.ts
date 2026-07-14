// dom-window.ts — the prompt-only DOM slimmer. These pin the load-bearing
// properties with tests that DISTINGUISH the new behavior from the old
// head-first slice: windowing rescues a deep target, engages ONLY when a
// head-first slice would miss it (zero regression), is content-neutral WITHIN
// the window (attributes/text preserved, escaped), never feeds a lossy window
// to the resolution rungs, and never throws or exceeds budget on hostile input.

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { deboilerplateDom, extractAnchorTexts, windowDom } from '../src/heal/dom-window';
import { countSelectorMatches, countTextMatches } from '../src/heal/resolve';

const BUDGET = 40_000;
const MARKER = /<!-- goldseam: DOM windowed to the region around .* -->/;

// A heavy page shaped to overflow the prompt: a big inlined <style> up front,
// then >40K of real markup, then the target card. `fillerFirst` flips
// filler/target order so the target sits either PAST the head (windowing must
// engage) or INSIDE it (windowing must NOT engage — zero regression).
const ANCHOR = 'Key Takeaways from the 2026 Summit';
const CARD =
  '<article data-framer-name="PostCard" data-testid="post-7" class="card">' +
  `<h2 class="title">${ANCHOR}</h2><a href="/post-7?a=1&amp;b=2">Read &amp; share</a>` +
  '<img src="/thumb-7.png"><input type="hidden" value="v7"></article>';
function heavyDom({ fillerFirst = true, styleReps = 6000, fillerReps = 900 } = {}): string {
  const style = `<style media="all">${'.f{color:red;padding:1px}'.repeat(styleReps)}</style>`;
  const filler = '<div class="row"><span>filler content line here</span></div>'.repeat(fillerReps);
  const body = fillerFirst ? `<nav>menu</nav>${filler}<main>${CARD}</main>` : `<main>${CARD}</main>${filler}`;
  return `<!doctype html><html><head>${style}</head><body>${body}</body></html>`;
}
const specAsserting = (t: string) => `it('shows the post', () => { cy.contains(${JSON.stringify(t)}); });`;

describe('deboilerplateDom', () => {
  it('empties <style>/<script> bodies, preserves tags + attributes + data-*', () => {
    const html =
      '<style id="s" media="print">.a{color:red}</style>' +
      '<script type="application/ld+json" data-testid="ld">{"x":1}</script>' +
      '<div data-testid="keep">hi</div>';
    expect(deboilerplateDom(html)).toBe(
      '<style id="s" media="print"></style>' +
        '<script type="application/ld+json" data-testid="ld"></script>' +
        '<div data-testid="keep">hi</div>',
    );
  });

  it('strips many style/script blocks and is idempotent', () => {
    const many = '<style>a{}</style><script>x()</script>'.repeat(50) + '<div>keep</div>';
    const once = deboilerplateDom(many);
    expect(once).not.toContain('a{}');
    expect(once).not.toContain('x()');
    expect(once).toContain('<div>keep</div>');
    expect(deboilerplateDom(once)).toBe(once);
  });
});

describe('extractAnchorTexts', () => {
  it('pulls contains() and should/and text-matcher arguments', () => {
    const src = `
      cy.contains('Recent Articles');
      cy.get('.x').should('contain', 'Add to basket');
      cy.get('.y').and('have.text', 'Checkout');`;
    expect(extractAnchorTexts(src)).toEqual(
      expect.arrayContaining(['Recent Articles', 'Add to basket', 'Checkout']),
    );
  });

  it('uses the LAST arg of a two-arg contains (scope selector is not page text)', () => {
    expect(extractAnchorTexts(`cy.contains('nav', 'Products list');`)).toEqual(['Products list']);
    expect(extractAnchorTexts(`cy.contains('nav', 'Products list');`)).not.toContain('nav');
  });

  it('rejects selector-shaped and trivially short arguments', () => {
    const got = extractAnchorTexts(`cy.contains('.product_pod'); cy.get('#id'); cy.contains('[data-x]'); cy.contains('ok');`);
    expect(got).not.toContain('.product_pod');
    expect(got).not.toContain('#id');
    expect(got).not.toContain('[data-x]');
    expect(got).not.toContain('ok'); // length 2
  });

  it('returns [] for a spec with no text assertions', () => {
    expect(extractAnchorTexts(`cy.get('.a').click();`)).toEqual([]);
  });
});

describe('windowDom — rescues a deep target (behavior the old slice could not)', () => {
  it('engages windowing and puts the deep spec-text target in the window', () => {
    const dom = heavyDom();
    const slim = deboilerplateDom(dom);
    expect(slim.length).toBeGreaterThan(BUDGET); // still overflows after strip
    expect(slim.slice(0, BUDGET)).not.toContain(ANCHOR); // a head-first slice WOULD miss it

    const r = windowDom(dom, { specSource: specAsserting(ANCHOR), budget: BUDGET });
    expect(r.strategy).toBe('windowed'); // <- fails under old head-first behavior
    expect(r.html).toContain(ANCHOR);
    expect(r.html).toMatch(MARKER); // the honesty marker is present
    expect(r.anchor).toContain('spec-text');
  });

  it('anchors on a surviving DISTINCTIVE sub-selector when there is no spec text', () => {
    const r = windowDom(heavyDom(), { failedSelector: 'main .card .missing', specSource: '', budget: BUDGET });
    expect(r.strategy).toBe('windowed');
    expect(r.html).toContain('data-framer-name="PostCard"');
  });

  it('does NOT anchor on a bare-tag sub-selector (would window an arbitrary region)', () => {
    // `main div` has no id/class/attr piece -> not distinctive -> no windowing
    const r = windowDom(heavyDom(), { failedSelector: 'main div', specSource: '', budget: BUDGET });
    expect(r.strategy).not.toBe('windowed');
  });

  it('rescues a target inside an open shadow root (parity with resolve.ts template descent)', () => {
    const filler = '<div class="row"><span>filler</span></div>'.repeat(1300);
    const shadow =
      `<html><body><nav>n</nav>${filler}<main><div id="host">` +
      '<template shadowrootmode="open"><button data-testid="sbtn">Shadow Target Heading</button></template>' +
      '</div></main></body></html>';
    const r = windowDom(shadow, { specSource: specAsserting('Shadow Target Heading'), budget: BUDGET });
    expect(r.strategy).toBe('windowed');
    expect(r.anchor).toContain('shadow/frame');
    expect(r.html).toContain('shadowrootmode'); // the template survives
    expect(r.html).toContain('sbtn'); // the target inside it survives
    // and resolution still counts it over the untouched capture
    expect(countSelectorMatches(shadow, '[data-testid=sbtn]', 'all')?.count).toBe(1);
  });

  it('emits a balanced ancestor scaffold so the region reads as real DOM', () => {
    const r = windowDom(heavyDom(), { specSource: specAsserting(ANCHOR), budget: BUDGET });
    expect(r.html).toContain('<body>');
    expect(r.html).toContain('</body>');
    expect(r.html).toContain('<main>');
    // round-trips through a parser without error
    expect(() => new JSDOM(r.html)).not.toThrow();
  });
});

describe('windowDom — content-neutral WITHIN the window', () => {
  it('preserves every selectable attribute of the target verbatim', () => {
    const r = windowDom(heavyDom(), { specSource: specAsserting(ANCHOR), budget: BUDGET });
    for (const attr of ['data-framer-name="PostCard"', 'data-testid="post-7"', 'href="/post-7', 'class="card"', 'value="v7"', 'src="/thumb-7.png"']) {
      expect(r.html).toContain(attr);
    }
  });

  it('re-encodes ancestor-scaffold attribute values (escapes quotes/&/<), round-tripping exactly', () => {
    const filler = '<div class="row">f</div>'.repeat(2500);
    const dom =
      '<html><body><main id="m" data-config="{&quot;k&quot;:&quot;v &amp; x&quot;}">' +
      `<section>${filler}<article data-testid="p7"><h2>Deep Anchor Heading XYZ</h2></article></section>` +
      '</main></body></html>';
    const r = windowDom(dom, { specSource: specAsserting('Deep Anchor Heading XYZ'), budget: BUDGET });
    expect(r.strategy).toBe('windowed');
    const back = new JSDOM(r.html).window.document.querySelector('main');
    expect(back?.getAttribute('data-config')).toBe('{"k":"v & x"}'); // exact value survives
    expect(back?.getAttribute('id')).toBe('m');
  });

  it('preserves entity-bearing text and href in the window', () => {
    const r = windowDom(heavyDom(), { specSource: specAsserting(ANCHOR), budget: BUDGET });
    const a = new JSDOM(r.html).window.document.querySelector('a[href^="/post-7"]');
    expect(a?.getAttribute('href')).toBe('/post-7?a=1&b=2'); // & decoded correctly
    expect(a?.textContent).toBe('Read & share');
  });
});

describe('windowDom — the zero-regression gate', () => {
  it('does NOT window when the target already sits in the head-first slice', () => {
    const dom = heavyDom({ fillerFirst: false }); // target FIRST, filler after
    const slim = deboilerplateDom(dom);
    expect(slim.length).toBeGreaterThan(BUDGET); // page overflows...
    expect(slim.slice(0, BUDGET)).toContain(ANCHOR); // ...but target is in the head
    const r = windowDom(dom, { specSource: specAsserting(ANCHOR), budget: BUDGET });
    expect(r.strategy).not.toBe('windowed'); // head-first behavior preserved
    expect(r.html).toContain(ANCHOR);
  });

  it('keeps head-first (does not window) when the anchor text also appears early', () => {
    // ANCHOR echoed in an early nav -> gate finds it in the head -> no windowing.
    // Honest: no worse than today; avoids windowing on an ambiguous anchor.
    const dom = heavyDom().replace('<nav>menu</nav>', `<nav>${ANCHOR}</nav>`);
    const r = windowDom(dom, { specSource: specAsserting(ANCHOR), budget: BUDGET });
    expect(r.strategy).not.toBe('windowed');
  });

  it('returns the whole DOM (deboilerplated) untouched when it fits the budget', () => {
    const dom = '<html><body><div data-testid="x">hi there friend</div></body></html>';
    const r = windowDom(dom, { specSource: specAsserting('hi there friend'), budget: BUDGET });
    expect(r.strategy).toBe('whole');
    expect(r.html).toBe(deboilerplateDom(dom));
  });

  // The no-anchor fallback ceiling (mirrors NO_ANCHOR_FALLBACK_CEILING in
  // dom-window.ts). A no-anchor page shows the WHOLE deboilerplated DOM up to
  // this bound, then truncates honestly — the fix for a heal target sitting
  // deep behind un-strippable chrome (Squarespace's ~144K blog list).
  const NO_ANCHOR_CEILING = 200_000;

  it('no anchor + moderately over budget: shows the whole page so a just-past-budget target survives', () => {
    // target sits just past the base budget; no spec anchor, broken single-token selector.
    const filler = '<div class="row">x</div>'.repeat(2000); // ~48K, over the base budget
    const dom = `<html><body>${filler}<main><div class="article-title">Late Target Title</div></main></body></html>`;
    const slim = deboilerplateDom(dom);
    expect(slim.length).toBeGreaterThan(BUDGET); // over the base budget...
    expect(slim.length).toBeLessThanOrEqual(NO_ANCHOR_CEILING); // ...but within the ceiling
    expect(slim.slice(0, BUDGET)).not.toContain('article-title'); // a base head-first slice WOULD miss it
    const r = windowDom(dom, { failedSelector: '.gone', specSource: '', budget: BUDGET });
    expect(r.strategy).not.toBe('windowed'); // no anchor -> not windowed
    expect(r.html).toContain('article-title'); // ...but the no-anchor fallback rescued the target
  });

  it('G1: no anchor + target far past the OLD 2x floor (Squarespace ~144K depth) is rescued', () => {
    // The regression this fix exists for: a heal target sits ~100K deep behind
    // un-strippable nav markup, no spec text anchor, a fully-renamed single-token
    // selector (no surviving sub-part). The old 2x=80K fallback missed it; the
    // ceiling shows the whole page (still under the ceiling) so the model sees it.
    const filler = '<div class="row">x</div>'.repeat(4200); // ~100K of chrome, well past the old 80K floor
    const dom = `<html><body><nav>menu</nav>${filler}<main><a class="summary-title-link-next">Announcing Our Series B</a></main></body></html>`;
    const slim = deboilerplateDom(dom);
    expect(slim.indexOf('summary-title-link-next')).toBeGreaterThan(2 * BUDGET); // deeper than the OLD fallback
    expect(slim.length).toBeLessThanOrEqual(NO_ANCHOR_CEILING);
    const r = windowDom(dom, { failedSelector: '.summary-title-link', specSource: '', budget: BUDGET });
    expect(r.strategy).not.toBe('windowed'); // no anchor
    expect(r.html).toContain('summary-title-link-next'); // the renamed target the model must now find
  });

  it('no anchor + past the CEILING: head-first slice, truncated and bounded at the ceiling', () => {
    const dom = `<html><body>${'<div class="row">x</div>'.repeat(9000)}<main><div class="way-late">z</div></main></body></html>`; // ~216K, past the ceiling
    const slim = deboilerplateDom(dom);
    expect(slim.length).toBeGreaterThan(NO_ANCHOR_CEILING);
    const r = windowDom(dom, { budget: BUDGET });
    expect(r.strategy).toBe('head-first');
    expect(r.truncated).toBe(true);
    expect(r.html).toContain('<!-- truncated for prompt -->');
    expect(r.html.length).toBeLessThanOrEqual(NO_ANCHOR_CEILING + 100); // bounded at the ceiling, not 2x budget
  });
});

describe('windowDom — resolution reads the FULL capture, never the lossy window', () => {
  it('the window is a lossy subset (fewer matches than the full DOM) — so it must not feed resolution', () => {
    // six targets spread past the head; anchor uniquely near the LAST one.
    const pad = (i: number) => `<section class="pad">${'z'.repeat(9000)}</section><b class="hit" data-testid="h${i}">x</b>`;
    const last = '<h3>Uniquely Late Section Marker</h3><b class="hit" data-testid="h6">x</b>';
    const dom = `<html><body>${[0, 1, 2, 3, 4].map(pad).join('')}<main>${last}</main></body></html>`;

    const full = countSelectorMatches(dom, '.hit', 'all')?.count;
    expect(full).toBe(6);

    const r = windowDom(dom, { specSource: specAsserting('Uniquely Late Section Marker'), budget: BUDGET });
    expect(r.strategy).toBe('windowed');
    const inWindow = countSelectorMatches(r.html, '.hit', 'all')?.count ?? 0;
    expect(inWindow).toBeLessThan(full!); // the window dropped matches — resolution over it would be WRONG
    expect(inWindow).toBeGreaterThanOrEqual(1); // but it kept the target neighborhood

    // the capture the resolution rungs actually read is byte-identical after the call
    const copy = String(dom);
    windowDom(dom, { specSource: specAsserting('Uniquely Late Section Marker'), budget: BUDGET });
    expect(dom).toBe(copy);
    expect(countSelectorMatches(dom, '.hit', 'all')?.count).toBe(6);
    expect(countTextMatches(dom, 'x')).toBeGreaterThan(0);
  });
});

describe('windowDom — robustness (never throws, always bounded)', () => {
  const hostile: Array<[string, string]> = [
    ['empty', ''],
    ['head only', '<html><head><title>t</title></head></html>'],
    ['no html/body', 'just text and <b>bold'],
    ['unclosed tags', '<div><span><a href="/x">link'],
    ['mismatched', '<div></span></div></p>'],
    ['entities', '<div data-testid="a">&amp;&lt;&#x1f600;&nbsp;</div>'],
    ['declarative shadow', '<div><template shadowrootmode="open"><span>s</span></template></div>'],
    ['self-closing void', '<div><img src="x"><br><input value="v"></div>'],
    ['unicode text', '<html><body><h2>日本語の見出しテキストです</h2></body></html>'],
    ['deeply nested', '<html><body>' + '<div>'.repeat(2000) + 'deep' + '</div>'.repeat(2000) + '</body></html>'],
  ];
  for (const [name, dom] of hostile) {
    it(`${name}: no throw, bounded output`, () => {
      let r: ReturnType<typeof windowDom> | undefined;
      expect(() => {
        r = windowDom(dom, { failedSelector: '.x .y', specSource: specAsserting('見出し'), budget: BUDGET });
      }).not.toThrow();
      expect(r!.html.length).toBeLessThanOrEqual(BUDGET + 500);
    });
  }

  it('stays bounded across a range of budgets including <= 0', () => {
    const dom = heavyDom();
    for (const b of [0, 50, 300, 1000, 5000]) {
      const r = windowDom(dom, { specSource: specAsserting(ANCHOR), budget: b });
      // marker+scaffold is an irreducible ~300-char floor; body never blows past budget
      expect(r.html.length).toBeLessThanOrEqual(Math.max(b, 600));
    }
  });

  it('hard-clamps output to budget even when the ancestor scaffold alone is huge', () => {
    // A very deep, attribute-heavy ancestor chain: the scaffold (open+close
    // tags) exceeds a small budget on its own, which the pre-clamp code let
    // through. filler pushes the anchor past the head so windowing engages.
    const deepOpen = Array.from({ length: 120 }, (_, i) => `<div class="scaffold-ancestor-longish-class-${i}">`).join('');
    const deepClose = '</div>'.repeat(120);
    const filler = '<p>pad</p>'.repeat(500);
    const dom = `<html><body>${filler}<main>${deepOpen}<h2>Deep Clamp Anchor Heading</h2>${deepClose}</main></body></html>`;
    const budget = 1000; // smaller than the ~5K scaffold overhead
    const r = windowDom(dom, { specSource: specAsserting('Deep Clamp Anchor Heading'), budget });
    expect(r.strategy).toBe('windowed');
    expect(r.html.length).toBeLessThanOrEqual(budget); // hard-bounded despite the huge scaffold
  });

  it('covers the single-over-budget-element truncation branch without throwing', () => {
    const filler = '<div class="row">f</div>'.repeat(1000);
    const huge = `<article data-testid="big"><h2>Late Unique Heading Here</h2>${'q'.repeat(120_000)}</article>`;
    const dom = `<html><body>${filler}<main>${huge}</main></body></html>`;
    const r = windowDom(dom, { specSource: specAsserting('Late Unique Heading Here'), budget: BUDGET });
    expect(r.html.length).toBeLessThanOrEqual(BUDGET + 500);
    expect(r.truncated).toBe(true);
  });

  it('an anchor with regex/quote metacharacters is matched literally (no regex compile)', () => {
    const weird = 'Price: $9.99 (a+b)* [x]';
    const filler = '<div class="row">r</div>'.repeat(1200);
    const dom = `<html><body>${filler}<main><p>${weird}</p></main></body></html>`;
    const r = windowDom(dom, { specSource: specAsserting(weird), budget: BUDGET });
    expect(() => r).not.toThrow();
    expect(r.html).toContain(weird);
  });

  it('does not catastrophically backtrack on adversarial unterminated style/script', () => {
    const evil = '<style>' + 'a'.repeat(200_000); // never closed
    const start = Date.now();
    expect(() => deboilerplateDom(evil)).not.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('windowDom — precision + bound (mutation-hardened)', () => {
  it('does NOT window on a bare-tag-only broken selector even when its tag is deep', () => {
    // filler is <p> only, so `section` appears nowhere in the head slice; the
    // distinctive filter must still refuse to anchor on a bare tag name.
    const filler = '<p class="ln">pad</p>'.repeat(2500);
    const dom = `<html><body>${filler}<section data-testid="deep"><h2>Deep Section Heading</h2></section></body></html>`;
    expect(deboilerplateDom(dom).length).toBeGreaterThan(BUDGET);
    const r = windowDom(dom, { failedSelector: 'section', specSource: '', budget: BUDGET });
    expect(r.strategy).not.toBe('windowed'); // bare `section` is not distinctive -> no anchor -> no windowing
  });

  it('trims a single over-budget element so windowed output stays hard-bounded', () => {
    const filler = '<div class="row">f</div>'.repeat(2500); // push the anchor past the head
    const dom = `<html><body>${filler}<main><article class="huge" data-testid="huge">${'Q'.repeat(120_000)}</article></main></body></html>`;
    expect(deboilerplateDom(dom).slice(0, BUDGET)).not.toContain('class="huge"');
    const r = windowDom(dom, { failedSelector: '.huge', specSource: '', budget: BUDGET });
    expect(r.strategy).toBe('windowed'); // engaged, and the chosen element alone exceeds budget
    expect(r.truncated).toBe(true); // exercises emitWindow's trim branch
    expect(r.html.length).toBeLessThanOrEqual(BUDGET + 300);
  });

  it('rescues a target inside inlined same-origin frame content (data-frame-content descent)', () => {
    const filler = '<div class="row"><span>filler</span></div>'.repeat(1300);
    const framed =
      `<html><body><nav>n</nav>${filler}<main>` +
      '<template data-frame-content><button data-testid="fbtn">Frame Target Heading</button></template>' +
      '</main></body></html>';
    const r = windowDom(framed, { specSource: specAsserting('Frame Target Heading'), budget: BUDGET });
    expect(r.strategy).toBe('windowed');
    expect(r.anchor).toContain('shadow/frame');
    expect(r.html).toContain('fbtn');
  });

  it('windows the DEEPEST bearer tightly, excluding far sibling content', () => {
    // filler shares the target's <main> ancestor: a non-deepest (ancestor)
    // anchor would drag the filler into the window; the deepest bearer must not.
    const filler = '<p class="pad">pad line here</p>'.repeat(1500);
    const dom = `<html><body><main>${filler}<section class="post"><h2>Tight Anchor Heading</h2><b data-testid="tgt">x</b></section></main></body></html>`;
    const r = windowDom(dom, { specSource: specAsserting('Tight Anchor Heading'), budget: BUDGET });
    expect(r.strategy).toBe('windowed');
    expect(r.html).toContain('data-testid="tgt"'); // target present
    expect(r.html).not.toContain('pad line here'); // far sibling filler excluded -> tight
  });
});

describe('windowDom — deterministic + drift-pinned', () => {
  it('same input yields byte-identical output', () => {
    const a = windowDom(heavyDom(), { specSource: specAsserting(ANCHOR), budget: BUDGET });
    const b = windowDom(heavyDom(), { specSource: specAsserting(ANCHOR), budget: BUDGET });
    expect(a.html).toBe(b.html);
  });

  it('emits the exact windowed bytes for a compact fixture (catches silent drift)', () => {
    const filler = '<p class="row">filler paragraph text</p>'.repeat(20);
    const dom = `<html><body><header>top</header>${filler}<main><section class="post"><h2>Late Heading Anchor</h2><a data-testid="go" href="/x">Open</a></section></main></body></html>`;
    // budget forces windowing on this small fixture
    const r = windowDom(dom, { specSource: specAsserting('Late Heading Anchor'), budget: 400 });
    expect(r.strategy).toBe('windowed');
    expect(r.html).toMatchInlineSnapshot(`
      "<!-- goldseam: DOM windowed to the region around spec-text "Late Heading Anchor"; page exceeds the prompt budget -->
      <body><main><section class="post"><h2>Late Heading Anchor</h2><a data-testid="go" href="/x">Open</a></section></main></body>"
    `);
  });
});
