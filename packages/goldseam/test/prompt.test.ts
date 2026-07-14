// The repair prompt slices the captured DOM head-first at
// MAX_PROMPT_DOM_CHARS. deboilerplateDom empties <style>/<script> bodies
// first so real, selectable content survives the slice on pages that inline
// large stylesheets/scripts ahead of their markup. These pin two things:
// the strip rescues a front-loaded target, and it is content-neutral for
// resolution (which reads the untouched artifact.domHtml, not the prompt).

import { describe, expect, it } from 'vitest';
import { buildRepairPrompt, deboilerplateDom } from '../src/heal/prompt';
import { countSelectorMatches, countTextMatches } from '../src/heal/resolve';
import { FailureArtifact } from '../src/shared/types';

// ~60 KB of inlined CSS, comfortably past the 40 KB prompt window, standing
// in for any page that front-loads its stylesheet. The target carries a
// framework-generated data-* name alongside a testid to prove arbitrary
// data-* attributes survive the strip untouched.
const BIG_STYLE = `<style>${'.cmp-x{color:red;background:blue}'.repeat(2000)}</style>`;
const TARGET = '<div data-component-name="Title" data-testid="blog-card">Blog Card</div>';
const HEAVY_DOM = `<html><head>${BIG_STYLE}</head><body><main>${TARGET}</main></body></html>`;

const artifactWith = (domHtml: string): FailureArtifact => ({
  schemaVersion: 1,
  title: 'blog renders cards',
  specPath: 'cypress/e2e/blog.cy.ts',
  errorMessage: 'Expected to find element: [data-testid="blog-card"], but never found it.',
  url: 'https://example.test/blog',
  domHtml,
  ariaSnapshot: '',
  redacted: true,
  failedSelector: '[data-testid="blog-card"]',
});

describe('deboilerplateDom', () => {
  it('empties <style>/<script> bodies but keeps tags and attributes', () => {
    const html =
      '<style id="s" media="print">.a{color:red}</style>' +
      '<script type="application/ld+json" data-testid="ld">{"x":1}</script>';
    expect(deboilerplateDom(html)).toBe(
      '<style id="s" media="print"></style>' +
        '<script type="application/ld+json" data-testid="ld"></script>',
    );
  });

  it('leaves structural DOM, data-*, and visible text untouched', () => {
    const slimmed = deboilerplateDom(HEAVY_DOM);
    expect(slimmed).toContain('data-component-name="Title"');
    expect(slimmed).toContain('data-testid="blog-card"');
    expect(slimmed).toContain('Blog Card');
    expect(slimmed).toContain('<main>');
    expect(slimmed).not.toContain('color:red'); // CSS body gone
  });

  it('is content-neutral: selector + text match counts are identical', () => {
    for (const sel of ['[data-testid=blog-card]', '[data-component-name=Title]', 'div', 'main']) {
      const before = countSelectorMatches(HEAVY_DOM, sel, 'all')?.count;
      const after = countSelectorMatches(deboilerplateDom(HEAVY_DOM), sel, 'all')?.count;
      expect(after).toBe(before);
    }
    expect(countTextMatches(deboilerplateDom(HEAVY_DOM), 'Blog Card')).toBe(
      countTextMatches(HEAVY_DOM, 'Blog Card'),
    );
  });
});

describe('buildRepairPrompt DOM window', () => {
  const base = {
    specSource: 'it("x", () => { cy.get(\'[data-testid="blog-card"]\'); });',
    selectorPriority: ['data-testid', 'id'],
  };

  it('rescues a target front-loaded behind a large <style> blob', () => {
    // Before-state: a blind head-first slice of the RAW capture sees only CSS.
    expect(HEAVY_DOM.slice(0, 40_000)).not.toContain('data-testid="blog-card"');
    expect(HEAVY_DOM.length).toBeGreaterThan(40_000);

    // After the strip the target lands inside the window.
    const prompt = buildRepairPrompt({ artifact: artifactWith(HEAVY_DOM), ...base });
    expect(prompt).toContain('data-testid="blog-card"');
    expect(prompt).toContain('data-component-name="Title"');
  });

  it('does not mutate artifact.domHtml (resolution reads the untouched capture)', () => {
    const artifact = artifactWith(HEAVY_DOM);
    buildRepairPrompt({ artifact, ...base });
    expect(artifact.domHtml).toBe(HEAVY_DOM);
  });

  it('keeps prompt truncation honest when content still overflows after stripping', () => {
    // >200K after stripping (no style/script here), no anchor -> the no-anchor
    // fallback shows up to the ceiling, then truncates honestly past it.
    const huge = `<body>${'<div class="card">card</div>'.repeat(8000)}</body>`; // ~224K, past the ceiling
    const prompt = buildRepairPrompt({ artifact: artifactWith(huge), ...base });
    expect(prompt).toContain('<!-- truncated for prompt -->');
  });

  it('omits the truncation marker once stripping fits the window', () => {
    const prompt = buildRepairPrompt({ artifact: artifactWith(HEAVY_DOM), ...base });
    expect(prompt).not.toContain('<!-- truncated for prompt -->');
  });

  it('drives the WINDOWED path end-to-end: deep target rescued, capture untouched', () => {
    // >40K of real markup after stripping, with the target past the head slice
    // and a spec-text anchor beside it — the case only windowing can rescue.
    const filler = '<div class="row"><span>filler content line</span></div>'.repeat(1100);
    const deepTarget = '<main><section><h2>Recent Articles</h2><div data-component-name="Title" data-testid="post-9">Ninth Post</div></section></main>';
    const dom = `<html><head><style>${'.z{color:red}'.repeat(3000)}</style></head><body><nav>menu</nav>${filler}${deepTarget}</body></html>`;
    const artifact = artifactWith(dom);
    const specSource = 'it("x", () => { cy.contains("Recent Articles"); cy.get(\'[data-testid="post-9"]\'); });';

    const slim = deboilerplateDom(dom);
    expect(slim.length).toBeGreaterThan(40_000);
    expect(slim.slice(0, 40_000)).not.toContain('data-testid="post-9"'); // head-first would miss it

    const prompt = buildRepairPrompt({ artifact, specSource, selectorPriority: ['data-testid', 'id'] });
    expect(prompt).toMatch(/<!-- goldseam: DOM windowed/); // windowed path engaged through buildRepairPrompt
    expect(prompt).toContain('data-testid="post-9"'); // deep target rescued into the prompt
    expect(prompt).toContain('Recent Articles');

    // the capture the resolution rungs read is byte-identical, full count intact
    expect(artifact.domHtml).toBe(dom);
    expect(countSelectorMatches(artifact.domHtml, '[data-testid=post-9]', 'all')?.count).toBe(1);
  });
});
