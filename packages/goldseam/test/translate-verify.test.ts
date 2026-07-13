// Deterministic post-translation selector verification (translate-verify.ts)
// + its wiring into translateSteps. Authoring has NO rerun rung, so a selector
// that matches nothing in the captured DOM is caught here or never. These pin:
//   (a) all selectors resolve → commands returned unchanged;
//   (b) a hallucination on attempt 0, valid on the retranslate → succeeds;
//   (c) persistent hallucination → giveUp naming the selector, nothing shipped;
//   (d) a jQuery-pseudo selector the parser can't evaluate → accepted;
//   (e) guarded re-derive: a unique quoted target text rescues a hallucination
//       with a resolving selector, no retranslate needed;
//   plus the impostor guards: ambiguous text and multiple failures never guess.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPromptCache, translateSteps } from '../src/plugin/translate';
import {
  rederiveUnresolved,
  strongAnchors,
  verifyCommands,
} from '../src/plugin/translate-verify';
import { promptKey, StepCommand } from '../src/shared/prompt-types';

const STUB = join(__dirname, '..', '..', '..', 'scripts', 'stub-model.mjs');
const stub = (mode: string): string => `cmd:node ${STUB} ${mode}`;

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'goldseam-verify-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ————————————————————————————————————————————————————————————————
// Unit-level: the verify helper in isolation
// ————————————————————————————————————————————————————————————————

describe('verifyCommands — resolution against the captured DOM', () => {
  const DOM =
    '<body><button data-testid="add-to-cart-5">Add to cart</button>' +
    '<input id="qty"><select name="size"><option>M</option></select></body>';

  it('(a) reports nothing when every action selector resolves', () => {
    const commands: StepCommand[] = [
      { action: 'click', selector: '[data-testid="add-to-cart-5"]' },
      { action: 'type', selector: '#qty', text: '2' },
      { action: 'select', selector: '[name="size"]', value: 'M' },
    ];
    expect(verifyCommands(commands, DOM)).toEqual([]);
  });

  it('flags a selector that matches nothing (a hallucination)', () => {
    const commands: StepCommand[] = [
      { action: 'click', selector: '[data-testid="buy-now-5"]' },
    ];
    const out = verifyCommands(commands, DOM);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 0, action: 'click', selector: '[data-testid="buy-now-5"]' });
  });

  it('never flags assert or visit — assert may target future state, visit has no element', () => {
    const commands: StepCommand[] = [
      { action: 'visit', url: '/' },
      { action: 'assert', selector: '#toast-that-appears-later', should: 'be.visible' },
    ];
    expect(verifyCommands(commands, DOM)).toEqual([]);
  });

  it('only grounds commands BEFORE the first visit — post-navigation selectors are unknown', () => {
    // The captured DOM is the page at authoring time. A leading visit means the
    // whole flow targets a page we do not hold, so nothing may be rejected —
    // rejecting a post-visit selector against the pre-visit capture is a false
    // positive (and would break any "go to the shop, then click X" flow).
    const flow: StepCommand[] = [
      { action: 'visit', url: '/shop' },
      { action: 'click', selector: '[data-testid="not-on-the-authoring-page"]' },
    ];
    expect(verifyCommands(flow, DOM)).toEqual([]);
    // A selector BEFORE the visit is still grounded and still checked.
    const pre: StepCommand[] = [
      { action: 'click', selector: '[data-testid="ghost"]' },
      { action: 'visit', url: '/shop' },
    ];
    expect(verifyCommands(pre, DOM)).toHaveLength(1);
  });

  it('(d) accepts a jQuery-pseudo selector the CSS parser cannot evaluate', () => {
    // `:visible` is not valid CSS — jsdom throws on it. The base `button`
    // exists, so stripping the pseudo resolves; we must NOT reject it.
    const commands: StepCommand[] = [{ action: 'click', selector: 'button:visible' }];
    expect(verifyCommands(commands, DOM)).toEqual([]);
  });

  it('accepts a wholly-unevaluable selector (defer, never reject on not-checkable)', () => {
    // `:contains()` with nothing else strippable → not statically checkable →
    // accepted, mirroring heal resolve's honesty rule.
    const commands: StepCommand[] = [{ action: 'click', selector: ':contains("Add to cart")' }];
    expect(verifyCommands(commands, DOM)).toEqual([]);
  });

  it('honors shadow scoping — resolves inside the host, flags a hallucinated host', () => {
    const shadowDom =
      '<body><sl-details><template shadowrootmode="open">' +
      '<div part="header">Header</div></template></sl-details></body>';
    const ok: StepCommand[] = [{ action: 'click', shadow: 'sl-details', selector: '[part="header"]' }];
    expect(verifyCommands(ok, shadowDom)).toEqual([]);
    const badHost: StepCommand[] = [{ action: 'click', shadow: 'sl-missing', selector: '[part="header"]' }];
    expect(verifyCommands(badHost, shadowDom)).toHaveLength(1);
    const badInner: StepCommand[] = [{ action: 'click', shadow: 'sl-details', selector: '[part="footer"]' }];
    expect(verifyCommands(badInner, shadowDom)).toHaveLength(1);
  });
});

describe('strongAnchors — explicit quoted / proper-noun texts only', () => {
  it('keeps quoted strings and Capitalized runs, drops lowercase content words', () => {
    const a = strongAnchors(['Add the Ember Mug to the cart', 'click the checkout button']);
    expect(a).toContain('Ember Mug'); // capitalized run
    expect(a).not.toContain('checkout'); // lowercase content word excluded
    expect(a).not.toContain('cart');
  });

  it('drops leading imperatives even when capitalized (Click/Type/…)', () => {
    expect(strongAnchors(['Click the Save panel'])).toEqual(['Save']);
  });
});

// ————————————————————————————————————————————————————————————————
// Guarded re-derive in isolation
// ————————————————————————————————————————————————————————————————

describe('rederiveUnresolved — impostor-guarded identity', () => {
  const commands: StepCommand[] = [{ action: 'click', selector: '[data-testid="ghost"]' }];

  it('(e) re-derives a resolving selector from a UNIQUE quoted target text', () => {
    const dom = '<body><a data-testid="signin-link" href="/login">Sign In</a></body>';
    const unresolved = verifyCommands(commands, dom);
    expect(unresolved).toHaveLength(1);
    const out = rederiveUnresolved(commands, unresolved, ['Click the "Sign In" link'], dom);
    expect(out.remaining).toEqual([]);
    expect((out.commands[0] as { selector: string }).selector).toBe('[data-testid="signin-link"]');
  });

  it('does NOT guess when the target text is ambiguous (>1 element)', () => {
    const dom = '<body><button>Sign In</button><a href="/login">Sign In</a></body>';
    const unresolved = verifyCommands(commands, dom);
    const out = rederiveUnresolved(commands, unresolved, ['Click the "Sign In" control'], dom);
    expect(out.remaining).toEqual(unresolved); // unchanged, no substitution
    expect(out.commands).toBe(commands);
  });

  it('does NOT guess when more than one selector failed (ambiguous mapping)', () => {
    const two: StepCommand[] = [
      { action: 'click', selector: '[data-testid="ghost-a"]' },
      { action: 'click', selector: '[data-testid="ghost-b"]' },
    ];
    const dom = '<body><a data-testid="real" href="/">Home</a></body>';
    const unresolved = verifyCommands(two, dom);
    expect(unresolved).toHaveLength(2);
    const out = rederiveUnresolved(two, unresolved, ['Click "Home"'], dom);
    expect(out.remaining).toHaveLength(2);
  });

  it('does NOT guess when two distinct texts each uniquely match (ambiguous identity)', () => {
    const dom =
      '<body><a data-testid="signin" href="/login">Sign In</a>' +
      '<a data-testid="register" href="/join">Register Now</a></body>';
    const unresolved = verifyCommands(commands, dom);
    const out = rederiveUnresolved(commands, unresolved, ['Open "Sign In" then "Register Now"'], dom);
    expect(out.remaining).toEqual(unresolved); // two identities → refuse to pick
  });
});

// ————————————————————————————————————————————————————————————————
// End-to-end through translateSteps with the cmd: stub
// ————————————————————————————————————————————————————————————————

describe('translateSteps — verify + retranslate + giveUp', () => {
  const DOM =
    '<body><button data-testid="real-target">Checkout</button></body>';

  it('(a) a navigating translation (leading visit) still passes — verify does not break the happy path', async () => {
    // The `translate` stub's flow starts with visit '/', so its selectors
    // target the post-visit shop page — not the authoring capture. Verify must
    // ground only pre-visit commands and leave this translation untouched
    // (regression guard for the prompt E2E, whose steps begin "go to the shop").
    const dom = '<body>authoring page — nothing here yet</body>';
    const steps = ['do the flow'];
    const entry = await translateSteps({ key: promptKey(steps), steps, url: 'http://x/', domHtml: dom }, stub('translate'), dir);
    expect(entry.giveUp).toBeUndefined();
    expect(entry.commands.some((c) => 'selector' in c && c.selector === '[data-testid="add-to-cart-5"]')).toBe(true);
  });

  it('(b) hallucination on attempt 0, valid on the retranslate → succeeds with the valid selector', async () => {
    // A lowercase step ("checkout") yields NO strong anchor, so re-derive is
    // skipped and the fix must come from the retranslate.
    const steps = ['click the checkout button'];
    const entry = await translateSteps(
      { key: promptKey(steps), steps, url: 'http://x/', domHtml: DOM },
      stub('translate-hallucinate-then-fix'),
      dir,
    );
    expect(entry.giveUp).toBeUndefined();
    expect((entry.commands[0] as { selector: string }).selector).toBe('[data-testid="real-target"]');
    // and it round-trips through the cache
    expect(loadPromptCache(dir, promptKey(steps))?.commands[0]).toMatchObject({ selector: '[data-testid="real-target"]' });
  });

  it('(c) a persistent hallucination gives up, caching a refusal that names the selector', async () => {
    const steps = ['click the checkout button']; // no strong anchor → no re-derive rescue
    await expect(
      translateSteps({ key: promptKey(steps), steps, url: 'http://x/', domHtml: DOM }, stub('translate-hallucinate-always'), dir),
    ).rejects.toThrow(/declined to translate.*ghost-target/);
    // the refusal is cached (deterministic reruns) with no shipped commands
    const cached = loadPromptCache(dir, promptKey(steps));
    expect(cached?.giveUp?.reason).toMatch(/ghost-target/);
    expect(cached?.commands).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('(e) guarded re-derive rescues a hallucination WITHOUT a retranslate', async () => {
    // Same always-hallucinate stub as (c), but the step names a unique quoted
    // target present in the DOM, so re-derive substitutes a resolving selector
    // on attempt 0 — the model never corrects, yet the translation succeeds.
    const dom = '<body><a data-testid="checkout-link" href="/checkout">Checkout</a></body>';
    const steps = ['Click the "Checkout" link'];
    const entry = await translateSteps(
      { key: promptKey(steps), steps, url: 'http://x/', domHtml: dom },
      stub('translate-hallucinate-always'),
      dir,
    );
    expect(entry.giveUp).toBeUndefined();
    expect((entry.commands[0] as { selector: string }).selector).toBe('[data-testid="checkout-link"]');
  });
});
