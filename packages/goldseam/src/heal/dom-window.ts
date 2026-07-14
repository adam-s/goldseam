// Prompt-only DOM slimming: shrink the captured HTML so the element a heal
// must find survives the fixed prompt budget, WITHOUT touching the artifact
// the resolution rungs read. Two layers, cheapest first:
//
//   1. deboilerplateDom — empty <style>/<script> bodies (see below).
//   2. windowDom — when the slimmed DOM still overflows the budget AND a
//      head-first slice would miss the relevant region, emit a neighborhood
//      window centered on an anchor tied to the failure, instead of the head.
//
// Why this file and not the capture: resolution (heal/resolve.ts,
// heal/stages.ts) counts selector/text matches over the UNTOUCHED
// artifact.domHtml. Everything here feeds ONLY the model prompt, so it can
// never change a match count. That is the load-bearing invariant — every
// export is a pure function of its input string and mutates nothing.
//
// Why an anchored window and not just a bigger slice: the slice is head-first,
// and on a large page the element a renamed selector should now point at can
// sit hundreds of KB down (a page-builder's blog card, a late list item). The
// head then holds only chrome and the model gives up on a healable page. But a
// heal is not a blind search — we know the selector that broke and the text
// the spec asserts, and the moved element is overwhelmingly still beside its
// old neighbors. So we anchor on a signal that survived the break and emit the
// DOM neighborhood around it. The window is a page *region*, wide enough that
// the model still does real disambiguation — we never hand it the answer.

import { closeWindow, parseDom } from './dom-env';

/**
 * Empty the *bodies* of <style>/<script> elements, keeping the opening tag
 * (with every attribute) and closing tag intact.
 *
 * When a page inlines its stylesheets and scripts, that markup carries no
 * selectable content but can dwarf the DOM — a build tool that inlines
 * critical CSS can put hundreds of KB ahead of the first real element. The
 * head-first prompt slice then fills with CSS/JS text and the model sees
 * nothing to select. That text is pure noise for selector reasoning; dropping
 * it moves real content back toward the front.
 *
 * Content-neutral by construction: structure, element count, and every
 * attribute survive (a heal target that is itself a <script>/<style> — never
 * observed, but permitted — stays intact and selectable). This is the lighter
 * cousin of translate.ts `translationDom`, which is free to *remove*
 * <head>/<script>/<style>/<svg> outright because it grounds NEW selectors in
 * body markup; a heal must point at a real, untouched element in this same
 * capture, so we empty rather than remove.
 */
export function deboilerplateDom(html: string): string {
  return html
    .replace(/(<style\b[^>]*>)[\s\S]*?<\/style\s*>/gi, '$1</style>')
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>');
}

/**
 * Text a spec asserts on — `contains()` arguments and the text argument of a
 * `should/and('contain'|'have.text'|'include.text', …)`. These are the
 * strongest anchors we have: a token rename cannot move the words on the page,
 * and the demo pattern asserts text co-located with the broken selector's
 * element, so the assertion sits right beside the target. Selector-shaped and
 * trivially short strings are dropped — they are not page text.
 */
export function extractAnchorTexts(specSource: string): string[] {
  const texts = new Set<string>();
  const add = (s: string): void => {
    const t = s.trim();
    // reject selector-shaped args (.foo, #id, [attr]) and noise
    if (t.length >= 3 && !/^[.#[]/.test(t) && /[a-z0-9]/i.test(t)) texts.add(t);
  };
  const strings = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (const m of specSource.matchAll(/\bcontains\s*\(([^)]*)\)/g)) {
    // cy.contains([selector,] text) — text is the LAST string arg; a leading
    // arg is a scope selector, not page text.
    const args = [...m[1].matchAll(strings)].map((s) => s[2]);
    if (args.length) add(args[args.length - 1]);
  }
  for (const m of specSource.matchAll(
    /\.(?:should|and)\s*\(\s*(['"`])(?:contain|have\.text|include\.text)[^)]*?\1\s*,\s*(['"`])((?:\\.|(?!\2).)*)\2/g,
  )) {
    add(m[3]);
  }
  return [...texts];
}

export interface WindowInput {
  /** artifact.failedSelector — parsed for surviving structural anchors. */
  failedSelector?: string;
  /** spec source — mined for asserted-text anchors. */
  specSource?: string;
  /** char budget for the DOM the prompt embeds. */
  budget: number;
  /** Extra selectors to anchor on — e.g. the offline ranker's top candidate.
   * When one resolves in the capture, the window centers on its region and the
   * budget is honored (no NO_ANCHOR ceiling), so a confident shortlist yields a
   * small, content-bearing DOM instead of the deep no-anchor fallback. Tried
   * AFTER the spec-text and surviving-sub-selector anchors. */
  anchorSelectors?: string[];
}

export interface WindowResult {
  /** the DOM string to embed in the prompt (already budget-bounded). */
  html: string;
  /** which path produced it — for the honesty marker and diagnostics. */
  strategy: 'whole' | 'head-first' | 'windowed';
  /** true when the emitted DOM was cut at the budget. */
  truncated: boolean;
  /** for windowed results: how the anchor was found (e.g. 'spec-text "…"'). */
  anchor?: string;
}

const TRUNC_MARKER = '\n<!-- truncated for prompt -->';

/** When no anchor can be found at all, we cannot center a window — but a hard
 * head-first cut at the budget silently drops a target that sits deeper than it
 * (a renamed single-token selector that offers no surviving sub-part, and an
 * assertion spec that offers no text anchor — the video-factory case, and the
 * Squarespace-blog case where the heal target sits ~144K deep behind a mega-nav
 * that no amount of style/script/svg emptying shrinks). With no region to aim
 * at, showing the model MORE of the page is strictly better: it is a content
 * superset, so it can only add context, never break a heal that worked on the
 * narrower slice. So the no-anchor slice widens all the way to a ceiling that
 * covers real page depth, not a small multiple of the budget.
 *
 * The ceiling exists only to bound prompt tokens on a genuinely enormous page
 * (and to keep a small-context self-hosted model from being handed a prompt it
 * cannot fit) — it is NOT a content judgment, so it is set well past where real
 * content sits on heavy real-world pages (measured: the deepest observed heal
 * target, Squarespace's `.summary-title-link` list, lands at char ~144K in the
 * deboilerplated DOM). A page whose target sits past the ceiling still truncates
 * honestly, exactly as before — just far later. Tunable; lower it for a
 * small-context model, raise it if a real target is ever seen deeper. */
export const NO_ANCHOR_FALLBACK_CEILING = 200_000;

/** Slice the head, honestly marked — today's behavior and the safe floor. */
function headFirst(slim: string, budget: number): WindowResult {
  return slim.length > budget
    ? { html: slim.slice(0, budget) + TRUNC_MARKER, strategy: 'head-first', truncated: true }
    : { html: slim, strategy: 'whole', truncated: false };
}

/** An anchor element plus a human-readable reason it was chosen. */
interface Anchor {
  el: Element;
  why: string;
}

/** Deepest element under `scope` whose own text contains `t` (the bearer, not
 * an ancestor). <template> elements are skipped — their content is a detached
 * fragment searched separately (see searchScopes). */
function deepestTextBearer(scope: ParentNode, t: string): Element | null {
  for (const el of Array.from(scope.querySelectorAll('*'))) {
    if (el.tagName === 'TEMPLATE') continue;
    if (!el.textContent?.includes(t)) continue;
    if (!Array.from(el.children).some((c) => c.textContent?.includes(t))) return el;
  }
  return null;
}

/** Split a selector into candidate structural sub-parts, longest prefix first,
 * then individual compound pieces — a token rename usually hits the
 * distinctive piece, so a *surviving* piece marks the neighborhood the renamed
 * element likely still lives in. Combinators are treated as whitespace.
 *
 * Only DISTINCTIVE pieces (carrying an id/class/attribute) are kept: a bare
 * tag name like `div` or `main` matches near the top of nearly every page, so
 * using it as an anchor would both defeat the head-first gate and window an
 * arbitrary region. */
function subSelectorParts(selector: string): string[] {
  const pieces = selector.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const parts: string[] = [];
  for (let n = pieces.length - 1; n >= 1; n--) parts.push(pieces.slice(0, n).join(' '));
  for (const p of pieces) parts.push(p);
  return [...new Set(parts)].filter((p) => /[.#[]/.test(p));
}

/** The document body plus every open-shadow / inlined-frame template content
 * fragment (`<template shadowrootmode>` / `<template data-frame-content>`),
 * each paired with its light-DOM host. This mirrors resolve.ts `countIn`:
 * anchoring must be able to see the same content resolution counts, or a heal
 * whose target lives in an open shadow root could never be windowed. A match
 * inside a fragment anchors on its host, whose serialization includes the
 * fragment. */
function searchScopes(doc: Document): Array<{ scope: ParentNode; host: Element | null }> {
  const scopes: Array<{ scope: ParentNode; host: Element | null }> = [
    { scope: doc.body ?? doc, host: null },
  ];
  for (const t of Array.from(
    doc.querySelectorAll('template[shadowrootmode], template[data-frame-content]'),
  )) {
    scopes.push({ scope: (t as HTMLTemplateElement).content, host: t });
  }
  return scopes;
}

/** Find an anchor: an asserted-text bearer first (most reliable — tied to the
 * test's intent and co-located with the target by the demo pattern), then a
 * surviving distinctive sub-part of the broken selector. Searches the light
 * DOM and open-shadow/frame content alike. Null when neither signal is
 * present. */
function findAnchor(doc: Document, input: WindowInput): Anchor | null {
  const scopes = searchScopes(doc);
  for (const t of extractAnchorTexts(input.specSource ?? '')) {
    for (const { scope, host } of scopes) {
      const el = deepestTextBearer(scope, t);
      if (el) return { el: host ?? el, why: `spec-text ${JSON.stringify(t)}${host ? ' (shadow/frame)' : ''}` };
    }
  }
  if (input.failedSelector) {
    for (const sel of subSelectorParts(input.failedSelector)) {
      for (const { scope, host } of scopes) {
        try {
          const el = scope.querySelector(sel);
          if (el) {
            return { el: host ?? el, why: `surviving sub-selector ${JSON.stringify(sel)}${host ? ' (shadow/frame)' : ''}` };
          }
        } catch {
          // an isolated piece may not be valid CSS on its own — skip it
        }
      }
    }
  }
  for (const sel of input.anchorSelectors ?? []) {
    for (const { scope, host } of scopes) {
      try {
        const el = scope.querySelector(sel);
        if (el) {
          return { el: host ?? el, why: `ranked candidate ${JSON.stringify(sel)}${host ? ' (shadow/frame)' : ''}` };
        }
      } catch {
        // not evaluable in this parser — skip
      }
    }
  }
  return null;
}

/** Escape an attribute value for hand-serialization (jsdom's outerHTML escapes
 * the body for us, but the scaffold tags are built by hand). Without this a
 * `data-*` value containing a quote or ampersand — routine on page-builder
 * sites — produces malformed markup. */
const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Opening/closing tags for the anchor's ancestor chain (up to and including
 * <body>), so the emitted fragment reads as a real DOM path and a descendant
 * selector written against it still resolves. Every attribute is preserved,
 * escaped. */
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
  const close = chain
    .map((n) => `</${n.tagName.toLowerCase()}>`)
    .reverse()
    .join('');
  return { open, close };
}

/** Emit the neighborhood around `anchor`: climb to the largest ancestor whose
 * serialized subtree fits the budget, then wrap it in its ancestor scaffold.
 * Output is hard-bounded by `budget`: the body is trimmed to what remains
 * after the marker and scaffold, and a final clamp covers the pathological
 * case where the scaffold ALONE (a very deep, attribute-heavy ancestor chain)
 * exceeds the budget — so the emitted string can never blow the budget. */
function emitWindow(anchor: Anchor, budget: number): WindowResult {
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
  let truncated = false;
  if (body.length > allowed) {
    body = body.slice(0, allowed);
    truncated = true;
  }
  let html = marker + open + body + close + (truncated ? TRUNC_MARKER : '');
  if (html.length > budget) {
    // Scaffold overhead alone exceeded the budget — hard-clamp the whole
    // string. Only reachable for a tiny budget or an absurdly deep chain
    // (never at the 40K production budget); correctness over prettiness.
    html = html.slice(0, budget);
    truncated = true;
  }
  return { html, strategy: 'windowed', truncated, anchor: anchor.why };
}

/**
 * Produce the DOM string for the repair prompt. Never throws; on any internal
 * error it degrades to the head-first slice (the pre-existing behavior).
 *
 * The gate that keeps this regression-proof: if a head-first slice already
 * contains a usable anchor, we return exactly that slice — no windowing, no
 * behavior change for any page that heals today. Windowing engages ONLY when
 * the head-first slice has no anchor at all, i.e. exactly the pages that give
 * up today. It is strictly additive.
 *
 * When NO anchor exists anywhere, there is no region to center on, so we fall
 * back to a wider head-first slice (up to NO_ANCHOR_FALLBACK_CEILING) — a
 * content superset of the old floor that rescues a target sitting deep behind
 * un-strippable chrome (a Squarespace mega-nav pushes the blog list to char
 * ~144K), and can never break a heal that worked on the narrower slice.
 */
export function windowDom(domHtml: string, input: WindowInput): WindowResult {
  // Own the two parse windows and close them once the result string is built.
  // The slim window must stay open through emitWindow (it serializes live
  // anchor nodes); the finally runs after the return expression evaluates, so
  // the html is already a string by the time either window closes.
  let headWindow: ReturnType<typeof parseDom>['window'] | undefined;
  let slimWindow: ReturnType<typeof parseDom>['window'] | undefined;
  try {
    const slim = deboilerplateDom(domHtml);
    if (slim.length <= input.budget) return { html: slim, strategy: 'whole', truncated: false };

    // Cheap gate: does a usable anchor already appear in the head-first slice?
    // Parse only the head (not the whole page) — if it does, keep today's
    // behavior verbatim. IMPORTANT: the gate ignores `anchorSelectors` (the
    // ranked-candidate anchors). Those are a DELIBERATE windowing signal for the
    // confident-shrink path — an early-appearing candidate (even a decoy) must
    // NOT trip the head gate and return a truncated head slice that bypasses the
    // NO_ANCHOR_FALLBACK_CEILING; candidate anchors only ever drive emitWindow
    // below, so the window centers on the candidate's actual region (which may
    // be deep) instead of the head.
    const head = slim.slice(0, input.budget);
    const headParsed = parseDom(head);
    headWindow = headParsed.window;
    if (findAnchor(headParsed.document, { ...input, anchorSelectors: undefined })) {
      return headFirst(slim, input.budget);
    }

    // Head-first would give up. Try to window around an anchor in the full DOM.
    const slimParsed = parseDom(slim);
    slimWindow = slimParsed.window;
    const anchor = findAnchor(slimParsed.document, input);
    if (!anchor) return headFirst(slim, Math.min(slim.length, NO_ANCHOR_FALLBACK_CEILING));
    return emitWindow(anchor, input.budget);
  } catch {
    // Robustness over cleverness: a malformed DOM or jsdom hiccup must never
    // fail a heal — fall back to the plain slice.
    const slim = deboilerplateDom(domHtml);
    return headFirst(slim, input.budget);
  } finally {
    closeWindow(headWindow);
    closeWindow(slimWindow);
  }
}
