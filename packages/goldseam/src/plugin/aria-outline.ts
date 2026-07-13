// A selector-carrying ACCESSIBILITY OUTLINE of a captured page, built as an
// opt-in, denser, better-grounded substitute for the raw-DOM window in the
// `cy.goldseam` authoring prompt (see translate.ts). NOT the default — the
// raw-DOM window stays the default; this engages only when
// `representation: 'aria'` is configured, and even then falls back to the DOM
// window whenever it cannot produce something useful.
//
// Constraint: the authoring model must ground each command's selector in the
// page it is given. Raw DOM HTML is a poor substrate — it is mostly markup the
// author never targets (scripts, styles, wrapper divs, inline data), it blows
// the prompt budget on large pages (the raw path hard-caps the DOM and windows
// or refuses when the target sits past the cap), and it forces the model to
// INVENT a selector from attributes rather than copy a known-good one. This
// walks goldseam's aria-snapshot tree over the same captured HTML and emits,
// for every interactive accessibility node, one line:
//
//     - role "accessible name"  « unique-css-selector »
//
// where the selector comes from aria-snapshot's `deriveSelector` and is
// therefore ALREADY unique and resolvable against the captured document. The
// model copies the selector verbatim instead of hunting markup; the same
// selector then passes the deterministic verify rung (translate-verify.ts)
// unchanged. Contextual landmarks (headings, nav, forms, dialogs) are listed
// name-only for orientation and are dropped first under budget pressure.
//
// SHADOW DOM: `deriveSelector` reports `boundary: 'shadow'`/`'frame'` for
// elements inside a serialized `<template shadowrootmode>` /
// `<template data-frame-content>`; the outline surfaces that with a `(shadow)`
// / `(frame)` tag so the model knows to reach for a `shadow` scope. We do NOT
// `expandSerializedTemplates` first — `generateAriaTree` already descends
// serialized templates, and expanding inlines them so `deriveSelector`
// mislabels shadow-scoped elements as document-boundary (verified under jsdom).
// Capture is the real shadow gate: a page whose only content sits in CLOSED
// shadow roots produces an empty walk → this returns null → the caller falls
// back to the raw-DOM window.
//
// SAFETY: this NEVER throws. Any failure (parse error, an aria-walk throw, an
// empty or ungrounded tree) returns null so `buildTranslatePrompt` falls back
// to the raw-DOM window that is the default. It is purely additive.

import { closeWindow, parseDom, withDomGlobals } from '../heal/dom-env';
import { deriveSelector, generateAriaTree, type AriaNode } from 'aria-snapshot';

/** Roles an author acts on directly — these carry a « selector ». */
const INTERACTIVE = new Set([
  'link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox',
  'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab',
  'switch', 'slider', 'spinbutton', 'gridcell', 'treeitem',
]);

/** Roles shown name-only for orientation — dropped first under budget pressure
 * because they carry no load-bearing selector. */
const CONTEXT = new Set([
  'heading', 'img', 'banner', 'navigation', 'main', 'complementary',
  'contentinfo', 'search', 'form', 'region', 'dialog', 'tablist', 'list',
  'article', 'alert', 'status', 'tabpanel',
]);

/** Selector strategies to try, best first. Deliberately excludes 'text'/'role'
 * — those produce a `cy.contains` shape, not a plain CSS `selector` the command
 * vocabulary and the verify rung expect. Every entry here yields a plain CSS
 * selector `deriveSelector` has verified matches exactly one element. */
const SEL_PRIORITY = ['data-cy', 'data-testid', 'id', 'name', 'aria-label', 'placeholder', 'css'];

/** Max accessible-name length rendered per line. */
const NAME_LEN = 80;

interface OutlineItem {
  line: string;
  interactive: boolean;
}

/** One compact interactive/landmark line per meaningful node, in document
 * order, each interactive line carrying a verified-unique CSS selector. */
function collectItems(root: AriaNode, document: Document): { items: OutlineItem[]; withSel: number } {
  const items: OutlineItem[] = [];
  let withSel = 0;

  const selectorFor = (el: Element | undefined): { sel: string; tag: string } | null => {
    if (!el) return null;
    try {
      const d = deriveSelector(el, { root: document, priority: SEL_PRIORITY });
      if (!d) return null;
      const tag = d.boundary === 'shadow' ? ' (shadow)' : d.boundary === 'frame' ? ' (frame)' : '';
      return { sel: d.selector, tag };
    } catch {
      return null; // a node we cannot address is not worth a line's selector
    }
  };

  const walk = (node: AriaNode | string, depth: number): void => {
    if (typeof node === 'string') return;
    const role = node.role;
    const name = (node.name || '').replace(/\s+/g, ' ').trim();
    const interactive = INTERACTIVE.has(role);
    // A nameless bare `list` is pure structure — skip it; a named one orients.
    const contextual = CONTEXT.has(role) && (name !== '' || role !== 'list');
    if (role && role !== 'fragment' && role !== 'generic' && (interactive || contextual)) {
      const indent = '  '.repeat(Math.min(depth, 10));
      let line = `${indent}- ${role}${name ? ` "${name.slice(0, NAME_LEN)}"` : ''}`;
      if (interactive) {
        const s = selectorFor(node.element);
        if (s) {
          withSel++;
          line += `  « ${s.sel}${s.tag} »`;
        } else {
          line += '  « (no unique selector) »';
        }
      }
      items.push({ line, interactive });
    }
    for (const c of node.children || []) walk(c, depth + 1);
  };

  walk(root, 0);
  return { items, withSel };
}

/** Assemble the outline under a CHAR budget (the same units and default as
 * `translationDom`'s DOM budget, so the two representations honor one number).
 * Order of sacrifice: whole outline → drop context-only lines (keep every
 * interactive selector line) → greedily keep interactive lines in document
 * order. A truncation marker is appended whenever anything was dropped. */
function assemble(items: OutlineItem[], withSel: number, budget: number): string {
  const render = (list: OutlineItem[]): string => list.map((i) => i.line).join('\n');
  const full = render(items);
  if (budget <= 0 || full.length <= budget) return full;

  // 1) Drop contextual-only lines; keep every interactive (selector-bearing) line.
  let kept = items.filter((i) => i.interactive);
  if (render(kept).length > budget) {
    // 2) Still over: greedily keep interactive lines in document order.
    const fit: OutlineItem[] = [];
    let acc = 0;
    for (const i of kept) {
      const cost = i.line.length + 1; // +1 for the joining newline
      if (acc + cost > budget) break;
      fit.push(i);
      acc += cost;
    }
    kept = fit;
  }
  const marker = `\n<!-- outline truncated to ~${budget} chars; ${kept.length}/${items.length} lines kept, ${withSel} verified selectors -->`;
  return render(kept) + marker;
}

export interface AriaOutlineOptions {
  /** CHAR ceiling for the emitted outline — same units/default as
   * `translationDom`'s DOM budget. 0/undefined means no cap. */
  budget?: number;
}

/**
 * Captured HTML → a compact, selector-carrying accessibility outline, or
 * `null` when no useful outline can be produced (parse error, empty/closed-only
 * tree, or no interactive node with a verified selector — the cases where the
 * caller should fall back to the raw-DOM window). NEVER throws.
 */
export function ariaOutline(domHtml: string, opts: AriaOutlineOptions = {}): string | null {
  const budget = opts.budget ?? 0;
  let parsed: ReturnType<typeof parseDom> | undefined;
  try {
    parsed = parseDom(domHtml);
    const { document, window } = parsed;
    const body = document.body;
    if (!body) return null;
    // The whole walk (generateAriaTree + deriveSelector) reads live nodes and
    // uses `Node.*`, `NodeFilter`, `instanceof HTML*Element` against the parsed
    // realm — run it with that realm's constructors installed as globals, and
    // return only the assembled STRING (no live node escapes withDomGlobals).
    const outline = withDomGlobals(window as Record<string, unknown>, () => {
      const snap = generateAriaTree(body, { forAI: true });
      const { items, withSel } = collectItems(snap.root, document);
      // An outline with no verified interactive selector gives the model no
      // grounding advantage over raw markup — defer to the DOM window instead.
      if (withSel === 0) return null;
      return assemble(items, withSel, budget);
    });
    return outline;
  } catch {
    // Parse or walk failure: additive feature, never a hard stop — fall back.
    return null;
  } finally {
    closeWindow(parsed?.window);
  }
}
