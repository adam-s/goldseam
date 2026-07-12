// The authoring twin of heal/dom-window.ts. When the stripped translation DOM
// still exceeds the prompt budget, a head-first slice drops the target a step
// names — on a page-builder or docs page the "Pricing" link or "Talk" tab sits
// hundreds of KB down, and the model refuses a perfectly translatable step
// (proven live: Opus and Sonnet both refuse wikipedia/webflow/github large
// pages a 40 K head cut can't reach). So we anchor on a signal from the STEPS
// (the words the author wrote) and emit the DOM neighborhood around it.
//
// Why a separate module and not a call into heal/dom-window.ts: the heal
// window anchors on the failed selector + asserted spec text; authoring has
// neither — its anchors are the English steps and, crucially, the human-facing
// attributes a NEW selector grounds on (a search box's only on-page token is
// its placeholder, never body text). The windowing MECHANISM is identical
// (climb to the largest ancestor that fits, wrap in an escaped ancestor
// scaffold, hard-bound to the budget); only the anchor source differs.
//
// Same guarantees as the heal window: never throws (any jsdom hiccup degrades
// to the head-first slice), regression-proof (if a head-first slice already
// holds an anchor, that exact slice is returned — every page that translates
// today is byte-identical), and output hard-bounded by the budget.

import { parseDom } from '../heal/dom-env';

/** Step words that never name a target — imperatives, articles, generic UI
 * nouns. Filtering is load-bearing: a step opens with "Click"/"Type"/"The", so
 * an unfiltered capitalized-word pass would treat "Click" as a distinctive
 * label (windowing an arbitrary region) and "The" would match in the head
 * slice and defeat the zero-regression gate. */
const STEP_STOP = new Set([
  'the', 'a', 'an', 'into', 'in', 'on', 'to', 'of', 'and', 'or', 'for', 'with', 'from',
  'that', 'this', 'click', 'type', 'select', 'check', 'uncheck', 'enter', 'press', 'set',
  'choose', 'link', 'button', 'tab', 'field', 'box', 'input', 'navigation', 'menu', 'nav',
  'page', 'should', 'contain', 'contains', 'text', 'first', 'second', 'third', 'last',
  'number', 'value', 'element', 'section', 'icon', 'toggle', 'option',
]);

/** Human-facing attributes a NEW selector can ground on. A control whose only
 * on-page token lives in placeholder/aria-label (a search input) is invisible
 * to a text-only anchor, so attribute matches are searched too. */
const ANCHOR_ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'name', 'value'];

const TRUNC_MARKER = '\n<!-- truncated -->';

/** Salient anchor tokens from the English steps, most-distinctive first:
 * quoted strings (verbatim intent), then Capitalized labels (Pricing/Talk),
 * then remaining content words — the last two stopword-filtered, selector-
 * shaped and trivially short tokens dropped. */
export function stepAnchors(steps: string[]): string[] {
  const ranked: string[] = [];
  const add = (s: string): void => {
    const t = s.trim();
    if (t.length >= 3 && !/^[.#[]/.test(t) && /[a-z0-9]/i.test(t) && !ranked.includes(t)) ranked.push(t);
  };
  for (const s of steps) for (const m of s.matchAll(/["'`]([^"'`]+)["'`]/g)) add(m[1]);
  for (const s of steps) for (const m of s.matchAll(/\b([A-Z][a-zA-Z0-9]{2,})\b/g)) if (!STEP_STOP.has(m[1].toLowerCase())) add(m[1]);
  for (const s of steps) for (const w of s.split(/[^A-Za-z0-9]+/)) if (!STEP_STOP.has(w.toLowerCase()) && w.length >= 3) add(w);
  return ranked;
}

/** Deepest element under `scope` whose OWN text contains `t` (the bearer, not
 * an ancestor). <template> content is a detached fragment searched separately. */
function deepestTextBearer(scope: ParentNode, t: string): Element | null {
  const lower = t.toLowerCase();
  for (const el of Array.from(scope.querySelectorAll('*'))) {
    if (el.tagName === 'TEMPLATE') continue;
    if (!el.textContent?.toLowerCase().includes(lower)) continue;
    if (!Array.from(el.children).some((c) => c.textContent?.toLowerCase().includes(lower))) return el;
  }
  return null;
}

/** An element whose grounding attribute (placeholder/aria-label/…) contains an
 * anchor token — the concrete control a form-field step names. */
function attrBearer(scope: ParentNode, t: string): Element | null {
  const lower = t.toLowerCase();
  for (const el of Array.from(scope.querySelectorAll('*'))) {
    for (const a of ANCHOR_ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.toLowerCase().includes(lower)) return el;
    }
  }
  return null;
}

interface Anchor {
  el: Element;
  why: string;
}

/** The body plus every open-shadow / inlined-frame template fragment paired
 * with its light-DOM host — a match inside a fragment anchors on its host,
 * whose serialization includes the fragment. */
function searchScopes(doc: Document): Array<{ scope: ParentNode; host: Element | null }> {
  const scopes: Array<{ scope: ParentNode; host: Element | null }> = [{ scope: doc.body ?? doc, host: null }];
  for (const t of Array.from(doc.querySelectorAll('template[shadowrootmode], template[data-frame-content]'))) {
    scopes.push({ scope: (t as HTMLTemplateElement).content, host: t });
  }
  return scopes;
}

/** First anchor: a text bearer for any step token, else an attribute bearer
 * (a form control whose label lives in placeholder/aria-label). */
function findAnchor(doc: Document, anchors: string[]): Anchor | null {
  const scopes = searchScopes(doc);
  for (const t of anchors) {
    for (const { scope, host } of scopes) {
      const el = deepestTextBearer(scope, t);
      if (el) return { el: host ?? el, why: `step-text ${JSON.stringify(t)}${host ? ' (shadow/frame)' : ''}` };
    }
  }
  for (const t of anchors) {
    for (const { scope, host } of scopes) {
      const el = attrBearer(scope, t);
      if (el) return { el: host ?? el, why: `step-attr ${JSON.stringify(t)}${host ? ' (shadow/frame)' : ''}` };
    }
  }
  return null;
}

const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Opening/closing tags for the anchor's ancestor chain up to <body>, so the
 * emitted fragment reads as a real DOM path and a descendant selector still
 * resolves. Every attribute preserved, escaped. */
function ancestorScaffold(chosen: Element): { open: string; close: string } {
  const chain: Element[] = [];
  for (let p = chosen.parentElement; p; p = p.parentElement) {
    chain.unshift(p);
    if (p.tagName === 'BODY') break;
  }
  const open = chain
    .map((n) => {
      const attrs = Array.from(n.attributes)
        .map((a) => (a.value === '' ? a.name : `${a.name}="${escapeAttr(a.value)}"`))
        .join(' ');
      return `<${n.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>`;
    })
    .join('');
  const close = chain.map((n) => `</${n.tagName.toLowerCase()}>`).reverse().join('');
  return { open, close };
}

/** Emit the neighborhood around `anchor`: climb to the largest ancestor whose
 * serialized subtree fits the budget, wrap in its scaffold, hard-bound to the
 * budget. */
function emitWindow(anchor: Anchor, budget: number): string {
  let chosen: Element = anchor.el;
  for (let p = anchor.el.parentElement; p && p.tagName !== 'HTML' && p.tagName !== 'BODY'; p = p.parentElement) {
    if (p.outerHTML.length <= budget) chosen = p;
    else break;
  }
  const { open, close } = ancestorScaffold(chosen);
  const marker = `<!-- goldseam: DOM windowed to the region around ${anchor.why}; page exceeds the prompt budget -->\n`;
  const overhead = marker.length + open.length + close.length + TRUNC_MARKER.length;
  const allowed = Math.max(0, budget - overhead);
  let body = chosen.outerHTML;
  let truncated = body.length > allowed;
  if (truncated) body = body.slice(0, allowed);
  const out = marker + open + body + close + (truncated ? TRUNC_MARKER : '');
  // Final hard clamp: a deep, attribute-heavy ancestor scaffold can itself
  // exceed the budget even with the body trimmed to zero (red-team finding).
  // The budget is a ceiling the small-context models the knob exists for
  // cannot cross, so the emitted region is never allowed past it.
  return out.length > budget ? out.slice(0, budget) : out;
}

/** Head-first slice, honestly marked — the pre-existing behavior and the safe
 * floor. */
function headFirst(stripped: string, budget: number): string {
  return stripped.length > budget ? stripped.slice(0, budget) + TRUNC_MARKER : stripped;
}

/**
 * Window the already-stripped translation DOM around a step anchor. Never
 * throws. The zero-regression gate: if a head-first slice already contains an
 * anchor, that exact slice is returned — every page that translates today is
 * byte-identical. Windowing engages only when the head slice has no anchor —
 * the pages that give up today.
 */
export function windowTranslationDom(stripped: string, anchors: string[], budget: number): string {
  let headWin: { close?: () => void } | undefined;
  let fullWin: { close?: () => void } | undefined;
  try {
    // Gate: does a usable anchor already appear in the head-first slice?
    const head = stripped.slice(0, budget);
    const headParsed = parseDom(head);
    headWin = headParsed.window as { close?: () => void };
    if (findAnchor(headParsed.document, anchors)) return headFirst(stripped, budget);

    // Head-first would give up. Window around an anchor in the full DOM.
    const fullParsed = parseDom(stripped);
    fullWin = fullParsed.window as { close?: () => void };
    const anchor = findAnchor(fullParsed.document, anchors);
    // No anchor anywhere → head-first at the budget. The heal window widens
    // here (a large fixed budget makes 2× safe), but authoring's budget may be
    // deliberately small to fit a self-hosted model's context, so the budget
    // stays a hard ceiling — never doubled past what the model can hold
    // (red-team finding).
    if (!anchor) return headFirst(stripped, budget);
    return emitWindow(anchor, budget);
  } catch {
    return headFirst(stripped, budget);
  } finally {
    try { headWin?.close?.(); } catch { /* releasing memory must not fail translation */ }
    try { fullWin?.close?.(); } catch { /* ditto */ }
  }
}
