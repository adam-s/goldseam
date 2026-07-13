// Deterministic post-translation selector verification for the authoring
// path (`cy.goldseam(steps)`). Authoring has NO rerun rung — a wrong
// selector is never caught downstream — so correctness here is on us.
//
// The failure mode this closes (live campaign, gap #3): a small or
// self-hosted model emits a selector that does NOT exist in the captured
// DOM (a hallucination). translateSteps trusted it. This module mirrors the
// heal `resolve` rung: every ACTION selector is checked against the captured
// DOM the model saw, offline, in milliseconds. A selector that matches
// nothing is a hallucination — the translation is unreliable and must not
// ship.
//
// Honesty rules carried over from heal/resolve.ts:
//   - A selector these functions cannot statically evaluate (a jQuery
//     pseudo the CSS parser rejects, an inner shadow selector we can't
//     resolve) is ACCEPTED, never rejected — an over-approximation must
//     never drive a rejection. Only a SOUND zero-match rejects.
//   - Re-derive is impostor-guarded: it substitutes a selector ONLY when a
//     single explicit quoted/proper-noun target text from the steps
//     resolves to exactly ONE element in the captured DOM, and the derived
//     selector resolves back to that same single element. Ambiguous (>1) or
//     absent identity → do not guess; fall through to retranslate/give-up.

import { closeWindow, parseDom, withDomGlobals } from '../heal/dom-env';
import { countSelectorMatches } from '../heal/resolve';
import { deriveSelector, queryAllDeep } from 'aria-snapshot';
import { StepCommand } from '../shared/prompt-types';
import { STEP_STOP } from './translate-window';

/** Actions whose `selector` names a concrete element that must exist in the
 * captured DOM. `assert` is excluded — its target may be legitimately
 * future-state (a toast/overlay that renders on interaction); `visit` and
 * `scrollTo`/`viewport`/`wait` carry no element selector. */
const VERIFIED_ACTIONS = new Set([
  'click',
  'dblclick',
  'type',
  'select',
  'check',
  'uncheck',
  'trigger',
]);

/** Priority for the re-derived selector: only strategies that yield a plain
 * CSS selector usable in a command's `selector` field. 'text'/'role' are
 * excluded — they produce a cy.contains shape, not a selector. */
const REDERIVE_PRIORITY = ['data-cy', 'data-testid', 'id', 'css'];

export interface UnresolvedSelector {
  /** Index into the command list — where to patch a re-derived selector. */
  index: number;
  action: string;
  selector: string;
  shadow?: string;
}

/** The verifiable selector target of a command, or null when the command
 * carries no element selector we check. */
function selectorTarget(cmd: StepCommand): { selector: string; shadow?: string } | null {
  if (!VERIFIED_ACTIONS.has(cmd.action)) return null;
  const selector = (cmd as { selector?: unknown }).selector;
  if (typeof selector !== 'string' || selector.length === 0) return null;
  const shadow = (cmd as { shadow?: unknown }).shadow;
  return { selector, shadow: typeof shadow === 'string' && shadow ? shadow : undefined };
}

type Resolution = 'resolves' | 'absent' | 'not-checkable';

/** Does `selector` resolve to >= 1 element inside the shadow root of the
 * `host` element(s)? Existence only — parity with a bare `cy.get` scoped by
 * the host. Not-checkable (defer/accept) when either selector is not plain
 * CSS; absent only when the host is present but nothing inside it matches, or
 * the host itself is absent (a hallucinated host). */
function resolvesInShadow(document: Document, host: string, selector: string): Resolution {
  let hosts: Element[];
  try {
    hosts = queryAllDeep(document, host);
  } catch {
    return 'not-checkable'; // host selector not plain CSS
  }
  if (hosts.length === 0) return 'absent';
  for (const h of hosts) {
    // queryAllDeep descends the host's serialized <template shadowrootmode>.
    let matches: Element[];
    try {
      matches = queryAllDeep(h, selector);
    } catch {
      return 'not-checkable'; // inner selector not plain CSS → defer
    }
    if (matches.length >= 1) return 'resolves';
  }
  return 'absent';
}

/** Resolution of one command's selector against the captured DOM. */
function resolveSelector(
  domHtml: string,
  target: { selector: string; shadow?: string },
  document?: Document,
): Resolution {
  if (target.shadow) {
    if (!document) return 'not-checkable';
    return resolvesInShadow(document, target.shadow, target.selector);
  }
  // Reuse the heal resolve machinery: strip:'all' tries the raw selector, then
  // (for jQuery pseudos) a stripped form. Null = not statically checkable. A
  // count of 0 is a SOUND absence even when approximate — stripping only ever
  // over-approximates, so approx 0 ⇒ real 0.
  const mc = countSelectorMatches(domHtml, target.selector, 'all');
  if (mc === null) return 'not-checkable';
  return mc.count >= 1 ? 'resolves' : 'absent';
}

/**
 * Every ACTION selector that matches NOTHING in the captured DOM — the
 * hallucinations. A selector that resolves, or that cannot be statically
 * evaluated (jQuery pseudo, unresolvable shadow inner), is not reported: only
 * sound zero-match rejects.
 *
 * Crucial scope: `domHtml` is the page as it stood WHEN `cy.goldseam` ran,
 * before any command executes. A `visit` navigates to a fresh page we do NOT
 * have, so every command AT OR AFTER the first visit targets an unknown DOM
 * and cannot be soundly checked — verifying it against the pre-visit capture
 * would be a false rejection. Only commands before the first navigation are
 * grounded in the DOM we hold; the rest are deferred (the model was told the
 * "current page may predate a visit step"). When the author is already on the
 * target page (no visit), every selector is verifiable — the case with teeth.
 */
export function verifyCommands(commands: StepCommand[], domHtml: string): UnresolvedSelector[] {
  const firstVisit = commands.findIndex((c) => c.action === 'visit');
  const grounded = firstVisit === -1 ? commands.length : firstVisit;
  const unresolved: UnresolvedSelector[] = [];
  let parsed: ReturnType<typeof parseDom> | undefined;
  try {
    for (let index = 0; index < grounded; index++) {
      const target = selectorTarget(commands[index]);
      if (!target) continue;
      if (target.shadow) parsed ??= parseDom(domHtml);
      if (resolveSelector(domHtml, target, parsed?.document) === 'absent') {
        unresolved.push({ index, action: commands[index].action, selector: target.selector, shadow: target.shadow });
      }
    }
  } finally {
    closeWindow(parsed?.window);
  }
  return unresolved;
}

/** Explicit target texts from the steps: quoted strings (verbatim intent),
 * then Capitalized proper-noun runs ("Ember Mug", "Sign In"). Deliberately
 * NOT the lowercase content words `stepAnchors` also mines — re-derive acts
 * only on an EXPLICIT, unambiguous name, never a generic word. */
export function strongAnchors(steps: string[]): string[] {
  const out: string[] = [];
  const add = (s: string): void => {
    const t = s.trim();
    if (t.length >= 3 && /[a-z0-9]/i.test(t) && !out.includes(t)) out.push(t);
  };
  for (const s of steps) for (const m of s.matchAll(/["'`]([^"'`]+)["'`]/g)) add(m[1]);
  for (const s of steps) {
    for (const m of s.matchAll(/\b([A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]{2,})*)\b/g)) {
      if (!STEP_STOP.has(m[1].split(/\s+/)[0].toLowerCase())) add(m[1]);
    }
  }
  return out;
}

/** Deepest elements under `root` (descending serialized templates) whose OWN
 * text contains `text` — the bearer, not an ancestor. What cy.contains yields
 * for a text argument. */
function deepBearers(root: ParentNode, text: string): Element[] {
  const lower = text.toLowerCase();
  const out: Element[] = [];
  const roots: ParentNode[] = [root];
  while (roots.length > 0) {
    const scope = roots.pop()!;
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (el.tagName === 'TEMPLATE') continue;
      if (!el.textContent?.toLowerCase().includes(lower)) continue;
      if (!Array.from(el.children).some((c) => c.textContent?.toLowerCase().includes(lower))) out.push(el);
    }
    for (const t of Array.from(
      scope.querySelectorAll('template[shadowrootmode], template[data-frame-content]'),
    )) {
      roots.push((t as HTMLTemplateElement).content);
    }
  }
  return out;
}

/**
 * Re-derive a resolving CSS selector for the single failing command, guarded
 * by identity uniqueness. Returns the selector ONLY when exactly one strong
 * anchor text resolves to exactly one directly-targetable element AND its
 * derived selector resolves back to that same single element. Any ambiguity
 * (>1 anchor identities, >1 bearers for an anchor, a shadow/frame-bound
 * element) → null; the caller then retranslates or gives up. Never guesses.
 */
function deriveForAnchors(document: Document, anchors: string[]): string | null {
  const winners = new Map<Element, string>();
  for (const text of anchors) {
    const bearers = deepBearers(document, text);
    if (bearers.length !== 1) continue; // absent or ambiguous for this text
    const el = bearers[0];
    const derived = deriveSelector(el, { root: document, priority: REDERIVE_PRIORITY });
    // Only a plain, document-boundary CSS selector is usable in a command's
    // selector field; a shadow/frame-bound selector needs a `shadow` scope we
    // are not re-deriving here.
    if (!derived || derived.kind !== 'css' || derived.boundary !== 'document') continue;
    const matches = queryAllDeep(document, derived.selector);
    if (matches.length === 1 && matches[0] === el) winners.set(el, derived.selector);
  }
  if (winners.size !== 1) return null; // 0 ⇒ nothing found; >1 ⇒ ambiguous
  return [...winners.values()][0];
}

/**
 * Guarded re-derive over the unresolved selectors. Only attempted when
 * EXACTLY ONE command failed to resolve and it carries no shadow scope — the
 * unambiguous single-target case. On success returns the patched command list
 * with an empty `remaining`; otherwise the commands are returned unchanged and
 * `remaining` still lists the failure(s) for the caller to retranslate.
 */
export function rederiveUnresolved(
  commands: StepCommand[],
  unresolved: UnresolvedSelector[],
  steps: string[],
  domHtml: string,
): { commands: StepCommand[]; remaining: UnresolvedSelector[] } {
  const noop = { commands, remaining: unresolved };
  if (unresolved.length !== 1) return noop; // ambiguous mapping → don't guess
  const target = unresolved[0];
  if (target.shadow) return noop; // shadow re-derive is out of scope
  const anchors = strongAnchors(steps);
  if (anchors.length === 0) return noop;

  let parsed: ReturnType<typeof parseDom>;
  try {
    parsed = parseDom(domHtml);
  } catch {
    return noop;
  }
  try {
    const selector = withDomGlobals(parsed.window, () => deriveForAnchors(parsed.document, anchors));
    if (!selector) return noop;
    const patched = commands.map((c, i) =>
      i === target.index ? ({ ...c, selector } as StepCommand) : c,
    );
    return { commands: patched, remaining: [] };
  } finally {
    closeWindow(parsed.window);
  }
}

/** Feedback appended to the retranslation prompt naming the offending
 * selector(s) — the model is told to copy a selector from the page HTML or
 * give up, never to invent one. */
export function verifyFeedback(unresolved: UnresolvedSelector[]): string {
  const list = unresolved
    .map((u) => `\`${u.selector}\`${u.shadow ? ` (inside shadow host \`${u.shadow}\`)` : ''}`)
    .join(', ');
  return `Your previous answer used selector(s) that match NOTHING in the page HTML above: ${list}. Every selector MUST be copied from the provided page HTML — locate the target element and use its actual id/class/attribute exactly as it appears. If you cannot locate the step's target in the HTML, reply {"giveUp":{"reason":"<what is missing>"}} instead. Do not invent or remember a selector.`;
}
