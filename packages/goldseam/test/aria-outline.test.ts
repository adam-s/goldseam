// @vitest-environment jsdom
//
// aria-outline.ts — the opt-in, selector-carrying accessibility outline that
// `representation: 'aria'` swaps into the translate prompt in place of the
// raw-DOM window. These pin the load-bearing properties:
//   (a) it emits role + name + a VERIFIED-UNIQUE selector per interactive node,
//       and those selectors resolve (they compose with the verify rung);
//   (b) an un-walkable page (empty / closed-shadow-only / garbage) returns null
//       and NEVER throws, so the caller falls back to the raw-DOM window;
//   (c) representation:'aria' embeds the outline; default/'dom' is byte-for-byte
//       the historical raw-DOM block (the default is provably unchanged);
//   (d) the char budget is honored (content capped, marker appended).
//
// The module is self-contained (it parses its own jsdom via parseDom and runs
// the aria walk under withDomGlobals), but the jsdom env keeps parity with the
// browser realm the plugin runs in and matches the other DOM-touching tests.

import { describe, expect, it } from 'vitest';
import { ariaOutline } from '../src/plugin/aria-outline';
import { buildTranslatePrompt, TranslatePayload } from '../src/plugin/translate';
import { verifyCommands } from '../src/plugin/translate-verify';
import { StepCommand } from '../src/shared/prompt-types';

const SHOP = `<html><body>
  <nav aria-label="Main"><a href="/" id="home">Home</a><a href="/cart" data-testid="cart-link">Cart</a></nav>
  <main>
    <h1>Shop</h1>
    <button data-cy="add-1">Add to cart</button>
    <input name="q" placeholder="Search products" type="search">
  </main>
</body></html>`;

const payload = (over: Partial<TranslatePayload>): TranslatePayload => ({
  key: 'k',
  steps: ['click add to cart'],
  url: 'https://shop.test/',
  domHtml: SHOP,
  ...over,
});

describe('ariaOutline', () => {
  it('emits role + name + a verified-unique selector per interactive node', () => {
    const out = ariaOutline(SHOP, { budget: 40_000 });
    expect(out).not.toBeNull();
    const outline = out as string;
    // Interactive nodes carry a « selector »; landmarks/headings are name-only.
    expect(outline).toContain('button "Add to cart"  « [data-cy="add-1"] »');
    expect(outline).toContain('link "Home"  « #home »');
    expect(outline).toContain('link "Cart"  « [data-testid="cart-link"] »');
    expect(outline).toContain('searchbox "Search products"  « [name="q"] »');
    // A landmark/heading orients but carries no selector.
    expect(outline).toContain('heading "Shop"');
    expect(outline).not.toContain('heading "Shop"  «');
  });

  it('emits selectors that RESOLVE — composes with the verify rung', () => {
    const out = ariaOutline(SHOP, { budget: 40_000 }) as string;
    // Pull every « selector » out of the outline and feed it through the same
    // deterministic verifier translateSteps runs on the model's output. An
    // aria-derived selector is unique-by-construction, so none is a hallucination.
    const selectors = [...out.matchAll(/« ([^»(]+?) »/g)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThanOrEqual(4);
    const commands: StepCommand[] = selectors.map((selector) => ({ action: 'click', selector }));
    expect(verifyCommands(commands, SHOP)).toEqual([]);
  });

  it('returns null (never throws) on an un-walkable page — caller falls back', () => {
    // Empty body: no interactive node → no grounding value → null.
    expect(ariaOutline('<html><body></body></html>')).toBeNull();
    // Not markup at all: parses to a bare text node, still no interactive → null.
    expect(ariaOutline('not html at all')).toBeNull();
    // A page whose only content is a CLOSED shadow root the capture never saw
    // (unreachable by design) → empty walk → null. Represented here as a page
    // with no interactive light-DOM content.
    expect(ariaOutline('<html><body><div><span>plain text</span></div></body></html>')).toBeNull();
    // Hostile input never throws — degrade to null.
    expect(() => ariaOutline('<<<>>><html <body')).not.toThrow();
  });

  it('honors the char budget — content capped, truncation marked', () => {
    const many =
      '<html><body>' +
      Array.from({ length: 40 }, (_, i) => `<button data-cy="b${i}">Button number ${i} label</button>`).join('') +
      '</body></html>';
    const full = ariaOutline(many, { budget: 40_000 }) as string;
    const capped = ariaOutline(many, { budget: 300 }) as string;
    expect(full).not.toContain('outline truncated');
    expect(capped).toContain('outline truncated');
    // Fewer lines survive the cap than the full outline has.
    expect(capped.split('\n').length).toBeLessThan(full.split('\n').length);
    // The kept CONTENT (everything before the marker) fits the budget; only the
    // accounting marker is allowed to spill past it.
    const content = capped.slice(0, capped.indexOf('\n<!-- outline truncated'));
    expect(content.length).toBeLessThanOrEqual(300);
  });
});

describe('buildTranslatePrompt — representation switch', () => {
  it("default omits representation → raw-DOM window (historical block)", () => {
    const prompt = buildTranslatePrompt(payload({}));
    expect(prompt).toContain('## Current page (may predate a visit step)');
    expect(prompt).toContain('```html');
    expect(prompt).not.toContain('accessibility outline');
    expect(prompt).not.toContain('« [data-cy="add-1"] »');
  });

  it("representation:'dom' is byte-identical to omitting it", () => {
    expect(buildTranslatePrompt(payload({ representation: 'dom' }))).toBe(
      buildTranslatePrompt(payload({})),
    );
  });

  it("representation:'aria' embeds the outline instead of the raw DOM", () => {
    const prompt = buildTranslatePrompt(payload({ representation: 'aria' }));
    expect(prompt).toContain('## Current page — accessibility outline');
    expect(prompt).toContain('VERIFIED to match exactly one element');
    expect(prompt).toContain('button "Add to cart"  « [data-cy="add-1"] »');
    // The aria block replaces the ```html fence with a plain fence.
    expect(prompt).not.toContain('```html');
  });

  it("representation:'aria' falls back to the raw-DOM window when the outline is null", () => {
    // A page with no interactive light-DOM content → ariaOutline returns null →
    // renderPageBlock falls through to the default raw-DOM window.
    const prompt = buildTranslatePrompt(
      payload({ representation: 'aria', domHtml: '<html><body><p>Just prose, nothing to click.</p></body></html>' }),
    );
    expect(prompt).toContain('## Current page (may predate a visit step)');
    expect(prompt).toContain('```html');
    expect(prompt).not.toContain('accessibility outline');
  });
});
