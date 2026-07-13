// Offline judgment against the captured DOM — the disambiguation guards
// (.agents/reference/disambiguation.md). Three consumers:
// - the `triage` rung: is this even a selector break? A "missing" selector
//   that still matches the captured DOM is a timing/state failure — give
//   up before any model call.
// - the `resolve` rung: does the healed selector land on exactly the
//   intended element in the DOM the model saw? Zero matches is a
//   hallucination; several matches where the chain expects one is
//   ambiguous. Both reject before any rerun.
// - the weak-assertion review flag: a rerun proves the healed test
//   *passes*, not that the selector points at the intended element; when
//   the only remaining checks are existence/visibility, the heal is
//   flagged for human review.
//
// Everything here runs on capture.domHtml — never the live app — so the
// checks are milliseconds and deterministic. Honesty rule: a selector
// these functions cannot evaluate produces a pass-with-evidence and is
// deferred to the rerun rungs, never a silent verdict either way.

import { RepairEdit } from './types';
import { parseDom as parseDomFull } from './dom-env';

const parseDom = (html: string): Document => parseDomFull(html).document;

export interface MatchCount {
  count: number;
  /** True when unsupported pseudo-classes were stripped before matching —
   * the count over-approximates: safe for absence checks, not uniqueness. */
  approximate: boolean;
  /** How many of `count` live inside inlined same-origin iframe content
   * (`template[data-frame-content]`) — bare cy.get cannot reach those;
   * a frame-only match deserves different evidence than a main-document
   * one. Shadow-root matches are NOT counted here (reachable with
   * `includeShadowDom`). */
  frameCount: number;
}

/** State-only jQuery pseudo-classes: presence of the base element still
 * means "present but state-gated", so triage may strip these. */
const STATE_PSEUDOS = /:(?:visible|hidden|animated|selected)\b/g;
/** Everything jQuery accepts and CSS does not, including content/position
 * filters — stripping these is only sound for absence checks. */
const JQUERY_PSEUDOS =
  /:(?:visible|hidden|animated|selected|input|submit|reset|button|text|password|file|image|checkbox|radio|header|parent)\b|:(?:first|last|even|odd)(?![\w-])|:(?:eq|lt|gt|contains)\((?:[^()]|\([^()]*\))*\)/g;

/** Count matches under `root`, descending into serialized shadow roots
 * (`<template shadowrootmode>`) and same-origin iframe content
 * (`<template data-frame-content>`) — a healed selector targeting either
 * must not read as absent. Boundary-safe (a combinator never crosses into
 * template content), and frame-content matches are tallied separately
 * because bare cy.get cannot reach them. */
function countIn(
  root: ParentNode,
  selector: string,
  inFrame = false,
): { total: number; frame: number } {
  const own = root.querySelectorAll(selector).length;
  let total = own;
  let frame = inFrame ? own : 0;
  for (const t of Array.from(
    root.querySelectorAll('template[shadowrootmode], template[data-frame-content]'),
  )) {
    const sub = countIn(
      (t as HTMLTemplateElement).content,
      selector,
      inFrame || t.hasAttribute('data-frame-content'),
    );
    total += sub.total;
    frame += sub.frame;
  }
  return { total, frame };
}

/**
 * How many elements `selector` matches in the captured DOM. `strip`
 * controls the fallback when the selector is not valid CSS: 'state' strips
 * only state pseudo-classes (triage), 'all' strips every jQuery-only
 * pseudo (resolve, absence checks). Null = not statically checkable.
 */
export function countSelectorMatches(
  domHtml: string,
  selector: string,
  strip: 'none' | 'state' | 'all',
): MatchCount | null {
  const attempts: Array<{ sel: string; approximate: boolean }> = [{ sel: selector, approximate: false }];
  if (strip !== 'none') {
    const stripped = selector.replace(strip === 'state' ? STATE_PSEUDOS : JQUERY_PSEUDOS, '').trim();
    if (stripped && stripped !== selector) attempts.push({ sel: stripped, approximate: true });
  }
  let document: Document | undefined;
  for (const attempt of attempts) {
    try {
      document ??= parseDom(domHtml);
      const { total, frame } = countIn(document, attempt.sel);
      return { count: total, approximate: attempt.approximate, frameCount: frame };
    } catch {
      // invalid selector — try the stripped form, else not checkable
    }
  }
  return null;
}

/** All elements matching `selector` under `root`, descending serialized shadow
 * / same-origin-frame templates (the element-returning sibling of `countIn`).
 * Boundary-safe: a combinator never crosses into template content. */
function queryDeepIn(root: ParentNode, selector: string): Element[] {
  const out: Element[] = Array.from(root.querySelectorAll(selector));
  for (const t of Array.from(
    root.querySelectorAll('template[shadowrootmode], template[data-frame-content]'),
  )) {
    out.push(...queryDeepIn((t as HTMLTemplateElement).content, selector));
  }
  return out;
}

/**
 * For a `.find()`-scoped heal `cy.get(parent).find(child)`: when `parent`
 * resolves to EXACTLY ONE element in the captured DOM, how many of its
 * descendants match `child`?
 *
 * This is what makes scoped uniqueness SOUND. A whole-document count
 * over-approximates within-parent uniqueness (the reason scoped calls default
 * to existence-only), but counting inside the single resolved parent does not.
 * Returns null — i.e. defer to the rerun rungs — when the parent is absent,
 * ambiguous, or not statically checkable, or when the child is not plain CSS
 * (a jQuery-pseudo count would over-approximate, and an over-approximation must
 * never drive a rejection). The returned count is therefore always exact.
 */
export function scopedChildCount(
  domHtml: string,
  parentSelector: string,
  childSelector: string,
): { count: number } | null {
  let document: Document;
  try {
    document = parseDom(domHtml);
  } catch {
    return null;
  }
  let parents: Element[];
  try {
    parents = queryDeepIn(document, parentSelector);
  } catch {
    return null; // parent selector not valid CSS → defer
  }
  if (parents.length !== 1) return null; // absent or ambiguous parent → defer
  try {
    return { count: queryDeepIn(parents[0], childSelector).length };
  } catch {
    return null; // child not valid CSS on its own (jQuery pseudo, …) → defer
  }
}

/**
 * Matches for a cy.contains() text argument: the DEEPEST elements whose
 * text contains the string, which is what Cypress yields. Several matches
 * are legal contains semantics (it takes the first), so callers only judge
 * absence.
 */
export function countTextMatches(domHtml: string, text: string): number {
  const roots: ParentNode[] = [parseDom(domHtml)];
  let n = 0;
  while (roots.length > 0) {
    const root = roots.pop()!;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (!el.textContent?.includes(text)) continue;
      if (!Array.from(el.children).some((c) => c.textContent?.includes(text))) n++;
    }
    for (const t of Array.from(
      root.querySelectorAll('template[shadowrootmode], template[data-frame-content]'),
    )) {
      roots.push((t as HTMLTemplateElement).content);
    }
  }
  return n;
}

export interface StringSite {
  /** Contents of the quoted string (the selector text). */
  value: string;
  /** Index of the opening quote in the source. */
  start: number;
  /** Index just past the closing quote. */
  end: number;
  /** Innermost call wrapping the string — 'get', 'contains', 'find', … */
  call?: string;
}

/**
 * The quoted string enclosing `index` in `source`, with its wrapping call
 * name. Comment-aware (spec comments carry apostrophes); null when `index`
 * is not inside a string literal.
 */
export function stringSiteAt(source: string, index: number): StringSite | null {
  let quote: string | null = null;
  let start = -1;
  const calls: string[] = [];
  let i = 0;
  while (i < index) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      if (nl === -1 || nl >= index) return null; // index is inside the comment
      i = nl;
    } else if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1 || close + 1 >= index) return null;
      i = close + 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      start = i;
    } else if (ch === '(') {
      const name = source.slice(0, i).match(/([\w$]+)\s*$/);
      calls.push(name ? name[1] : '?');
    } else if (ch === ')') {
      calls.pop();
    }
    i++;
  }
  if (!quote) return null;
  let j = index;
  while (j < source.length && source[j] !== quote) j += source[j] === '\\' ? 2 : 1;
  if (j >= source.length) return null;
  return { value: source.slice(start + 1, j), start, end: j + 1, call: calls[calls.length - 1] };
}

/**
 * Apply one edit and locate the healed selector string it produced. Null
 * when the edit does not apply or the change is not inside a string (the
 * validator makes both unreachable for accepted proposals).
 */
export function healedSiteForEdit(
  specSource: string,
  edit: RepairEdit,
): { site: StringSite; healedSource: string } | null {
  const pos = specSource.indexOf(edit.oldString);
  if (pos === -1) return null;
  const healedSource =
    specSource.slice(0, pos) + edit.newString + specSource.slice(pos + edit.oldString.length);
  let p = 0;
  while (
    p < edit.oldString.length &&
    p < edit.newString.length &&
    edit.oldString[p] === edit.newString[p]
  ) p++;
  const site = stringSiteAt(healedSource, pos + p);
  return site && { site, healedSource };
}

/**
 * The selector of a directly-resolved `cy.get('parent')` immediately scoping a
 * healed `.find('child')` site — i.e. the exact `cy.get('P').find(<site>)`
 * shape, where `<site>` opens at `siteStart`. Null for anything else: a
 * chained/scoped parent (`cy.get('a').find('b').find(<site>)`), a `.within()`
 * block, or a variable subject cannot be soundly resolved offline, so the
 * caller defers to the rerun. Sound by construction — a non-match never rejects.
 */
export function directGetParentFor(source: string, siteStart: number): string | null {
  const before = source.slice(0, siteStart);
  // …cy.get('P') . find (   [optional whitespace, then the site opens]
  const m = before.match(/\bcy\s*\.\s*get\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)\s*\.\s*find\s*\(\s*$/);
  return m ? m[2] : null;
}

/** Does the chain after the selector expect a collection? (.first()/.eq()/
 * have.length/… make a multi-match legitimate.) Heuristic over the rest of
 * the statement; false negatives only cost the model one retry. */
export function impliesCollection(source: string, from: number): boolean {
  const semi = source.indexOf(';', from);
  const window = source.slice(from, semi === -1 ? from + 300 : Math.min(semi, from + 300));
  return /\.(?:first|last|eq|filter|not|each|its|spread|contains)\s*\(|have\.length|\{\s*multiple\s*:\s*true/.test(
    window,
  );
}

/** Assertions that almost any element satisfies — a rerun green under only
 * these proves "passes", not "points at the intended element". */
const WEAK_ASSERTIONS = new Set(['exist', 'be.visible']);

/** Mocha's hook naming in failure titles — a capture bearing it healed
 * HOOK code, which gates every test in the suite. */
export const HOOK_TITLE_RE = /"(?:before|after) (?:each|all)" hook(?: for "[^"]*")?$/;

/**
 * Assertion strings chained anywhere in the rest of the enclosing test
 * (up to the next it/describe) — the window the rerun rung re-verifies.
 * A downstream strong assertion (`have.text` on a counter) behaviorally
 * constrains the heal even when the healed chain itself only clicks.
 * `wholeFile` widens the window to EOF — right for hook heals, where the
 * behavioral constraint is every gated test (proving-campaign finding:
 * the flag misfired on a beforeEach heal whose gated tests assert
 * strongly).
 */
export function assertionsAfter(source: string, from: number, wholeFile = false): string[] {
  const boundary = wholeFile ? -1 : source.slice(from).search(/\n\s*(?:it|describe)\s*[.(]/);
  const window = source.slice(from, boundary === -1 ? source.length : from + boundary);
  const found: string[] = [];
  const re = /\.(?:should|and)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (let m = re.exec(window); m; m = re.exec(window)) found.push(m[2]);
  if (/\bexpect\s*\(/.test(window)) found.push('expect(…)');
  return found;
}

/**
 * Does `selector` occur in the spec AS CODE — inside a string literal —
 * rather than only in comments? The sibling-heal probe keyed on plain
 * substring inclusion, and a header comment mentioning the broken
 * selector defeated it (proving-campaign finding, Juice Shop: healed
 * captures re-burned model calls and overwrote healed artifacts with
 * gave-ups).
 */
export function selectorOccursInCode(source: string, selector: string): boolean {
  for (let i = source.indexOf(selector); i !== -1; i = source.indexOf(selector, i + 1)) {
    if (stringSiteAt(source, i)) return true;
  }
  return false;
}

export const isWeaklyAsserted = (assertions: string[]): boolean =>
  assertions.every((a) => WEAK_ASSERTIONS.has(a)); // none at all ⇒ action-only ⇒ weak

/**
 * Review flags for a verified heal (recorded on the heal artifact, shown
 * by the CLI and report). Flags never block — they route human attention.
 */
export function reviewFlagsFor(
  specSource: string,
  edits: RepairEdit[],
  options?: { hookHeal?: boolean },
): string[] {
  let located = 0;
  let allWeak = true;
  for (const edit of edits) {
    const healed = healedSiteForEdit(specSource, edit);
    if (!healed) continue;
    located++;
    if (!isWeaklyAsserted(assertionsAfter(healed.healedSource, healed.site.end, options?.hookHeal))) {
      allWeak = false;
    }
  }
  if (located > 0 && allWeak) {
    return [
      'weak-assertions: every check on the healed test is existence/visibility-only — the rerun proves it passes, not that the selector points at the intended element; review the target manually',
    ];
  }
  return [];
}
