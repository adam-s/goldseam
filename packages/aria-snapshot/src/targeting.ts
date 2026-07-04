// Targeting utilities — goldseam-original code, not part of the Playwright
// lift (see NOTICE for what is).
//
// The aria tree is an addressing space, not just evidence: a node like
// `button "Add to cart"` names an element, getAllByAria resolves that name
// to the element, and deriveSelector turns the element back into the best
// available native selector. Together they let a tool (or a model) point
// at WHAT to target semantically while code decides HOW to target it —
// the untrusted step shrinks from "author a selector" to "pick a node".
//
// Serialization conventions these utilities understand, in captured DOM:
// - `<template shadowrootmode>` — declarative shadow DOM (the standard).
// - `<template data-frame-content>` — a same-origin iframe's document,
//   inlined as a sibling of its <iframe> by the capturing tool.

import * as roleUtils from './roleUtils';
import { normalizeWhiteSpace } from './isomorphic/stringUtils';

const SERIALIZED_TEMPLATES = 'template[shadowrootmode], template[data-frame-content]';

/**
 * querySelectorAll that also descends serialized shadow-root and iframe
 * templates. Matches never cross a template boundary (a descendant
 * combinator cannot reach from the host document into frame content).
 */
export function queryAllDeep(root: ParentNode, selector: string): Element[] {
  const out: Element[] = Array.from(root.querySelectorAll(selector));
  for (const t of Array.from(root.querySelectorAll(SERIALIZED_TEMPLATES))) {
    out.push(...queryAllDeep((t as HTMLTemplateElement).content, selector));
  }
  return out;
}

/**
 * Rewrite serialized shadow/iframe templates as plain `<div>` wrappers, in
 * place, so that ordinary CSS queries and the aria walk traverse a
 * rehydrated capture with real computed styles. Intended for throwaway
 * documents (a capture parsed for analysis), not live pages. Boundary
 * caveat: after expansion, selectors CAN match across what was a
 * shadow/frame boundary — use queryAllDeep on the unexpanded DOM when
 * boundary fidelity matters.
 */
export function expandSerializedTemplates(root: Element): void {
  const doc = root.ownerDocument;
  for (
    let t = root.querySelector(SERIALIZED_TEMPLATES);
    t;
    t = root.querySelector(SERIALIZED_TEMPLATES)
  ) {
    const wrapper = doc.createElement('div');
    for (const attr of Array.from(t.attributes)) {
      wrapper.setAttribute(attr.name === 'shadowrootmode' ? 'data-shadow-content' : attr.name, attr.value);
    }
    for (const child of Array.from((t as HTMLTemplateElement).content.childNodes)) {
      wrapper.appendChild(doc.importNode(child, true));
    }
    t.replaceWith(wrapper);
  }
}

export interface DerivedTarget {
  /** 'css' → use with querySelector/cy.get; 'contains' → tag + text
   * (Cypress: cy.contains(selector, text)). */
  kind: 'css' | 'contains';
  /** The CSS selector, or for 'contains' the tag qualifier. */
  selector: string;
  /** For 'contains': the text argument. */
  text?: string;
  /** Which priority rung produced it (e.g. 'data-testid', 'text', 'css'). */
  strategy: string;
  /** Matches in `root` at derivation time; always 1 (uniqueness is required). */
  matches: number;
  /** Where the element lives: 'document' is directly targetable; 'shadow'
   * needs shadow-piercing (Cypress `includeShadowDom`); 'frame' selectors
   * only resolve inside their iframe document — a bare top-level query
   * cannot reach them. */
  boundary: 'document' | 'shadow' | 'frame';
}

const DEFAULT_PRIORITY = ['data-cy', 'data-testid', 'id', 'text', 'css'];

/**
 * Derive the best unique selector for `element`, walking `priority` in
 * order. Entries: 'id', 'text' (tag + accessible name/own text, the
 * cy.contains shape), 'css' (structural :nth-of-type path), and anything
 * else is treated as an attribute name ('data-cy', 'name', 'aria-label'…).
 * Every candidate is verified unique against `root` (template-descending);
 * a non-unique candidate falls through to the next strategy. Null when
 * nothing unique exists within the priority list.
 */
export function deriveSelector(
  element: Element,
  options?: { root?: ParentNode; priority?: string[] },
): DerivedTarget | null {
  const root = options?.root ?? element.ownerDocument;
  const priority = options?.priority ?? DEFAULT_PRIORITY;
  const boundary = boundaryOf(root, element);
  roleUtils.beginAriaCaches();
  try {
    for (const strategy of priority) {
      const target = tryStrategy(element, root, strategy);
      if (target) return { ...target, boundary };
    }
  } finally {
    roleUtils.endAriaCaches();
  }
  return null;
}

/** Which boundary encloses `element` under `root`: serialized frame
 * content ('frame') wins over shadow content ('shadow'); anything
 * directly under root (or live shadow/frame — caller's document) is
 * 'document'. */
function boundaryOf(root: ParentNode, element: Element): DerivedTarget['boundary'] {
  const find = (
    node: ParentNode,
    current: DerivedTarget['boundary'],
  ): DerivedTarget['boundary'] | null => {
    if (node.contains(element)) return current;
    for (const t of Array.from(node.querySelectorAll(SERIALIZED_TEMPLATES))) {
      const kind = t.hasAttribute('data-frame-content') ? 'frame' : current === 'frame' ? 'frame' : 'shadow';
      const found = find((t as HTMLTemplateElement).content, kind);
      if (found) return found;
    }
    return null;
  };
  return find(root, 'document') ?? 'document';
}

/** Internal candidate before the boundary is stamped on. */
type DerivedCandidate = Omit<DerivedTarget, 'boundary'>;

const escapeAttrValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const attrSelector = (name: string, value: string): string =>
  `[${name}="${escapeAttrValue(value)}"]`;

function uniqueCss(
  root: ParentNode,
  selector: string,
  element: Element,
  strategy: string,
): DerivedCandidate | null {
  const matches = queryAllDeep(root, selector);
  if (matches.length === 1 && matches[0] === element) {
    return { kind: 'css', selector, strategy, matches: 1 };
  }
  return null;
}

function tryStrategy(element: Element, root: ParentNode, strategy: string): DerivedCandidate | null {
  if (strategy === 'id') {
    const id = element.getAttribute('id');
    if (!id) return null;
    const selector = /^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : attrSelector('id', id);
    return uniqueCss(root, selector, element, 'id');
  }

  if (strategy === 'text' || strategy === 'role') {
    const name = normalizeWhiteSpace(
      roleUtils.getElementAccessibleName(element, false) || element.textContent || '',
    );
    if (!name || name.length > 80) return null;
    const tag = element.tagName.toLowerCase();
    // The cy.contains(tag, text) contract: to be safe the text must select
    // OUR element unambiguously among all same-tag elements containing it.
    const containing = queryAllDeep(root, tag).filter((el) => el.textContent?.includes(name));
    if (containing.length === 1 && containing[0] === element) {
      return { kind: 'contains', selector: tag, text: name, strategy: 'text', matches: 1 };
    }
    return null;
  }

  if (strategy === 'css') {
    return cssPath(element, root);
  }

  const value = element.getAttribute(strategy);
  if (value === null) return null;
  return uniqueCss(root, attrSelector(strategy, value), element, strategy);
}

/** Structural fallback: shortest `tag:nth-of-type` chain, growing upward
 * until unique. Capped depth — an element this hard to address is better
 * reported unaddressable than given a 12-hop selector. */
function cssPath(element: Element, root: ParentNode): DerivedCandidate | null {
  const segments: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < 10; depth++) {
    let segment = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
      if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
    }
    segments.unshift(segment);
    const target = uniqueCss(root, segments.join(' > '), element, 'css');
    if (target) return target;
    current = parent;
  }
  return null;
}
