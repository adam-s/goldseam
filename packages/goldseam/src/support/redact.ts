// Capture-time redaction. The captured DOM is fed to a repair model, so the
// redaction guarantees documented in the package README are enforced here:
//
// 1. Values of text-entry form controls are never captured (the `value`
//    attribute is stripped from inputs/textareas/options, except
//    button-like inputs whose value is their visible label).
// 2. Email-like text and long digit runs (7+ digits, or 12+ digits with
//    separators — phone/card/account shaped) are masked in text nodes,
//    attribute values, and the aria snapshot.
//
// Redaction is deliberately dumb and over-eager: a masked price is a
// cheaper mistake than a leaked card number.

import { cloneWithShadow } from './shadow';

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const DIGIT_RUN_RE = /\d(?:[\s-]?\d){6,}/g;
const JWT_RE = /\beyJ[\w-]{4,}\.[\w-]+\.[\w-]*/g;
const HEX_TOKEN_RE = /\b[0-9a-f]{32,}\b/gi;
// Base64ish runs are only tokens if they carry digits — prose never does.
const BASE64_CANDIDATE_RE = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
const SENSITIVE_QUERY_RE =
  /([?&](?:token|key|secret|session|sid|auth|password|code|signature|api_?key|access_token|id_token|refresh_token)=)[^&\s"'<>]+/gi;

/**
 * Mask secret-shaped content in a string — emails, long digit runs
 * (phone/card/account), JWTs, hex/base64 tokens, and sensitive
 * query-string values. Also used on the aria YAML and the capture URL.
 */
export function maskText(text: string): string {
  return text
    .replace(SENSITIVE_QUERY_RE, '$1[redacted]')
    .replace(JWT_RE, '[redacted-jwt]')
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(HEX_TOKEN_RE, '[redacted-token]')
    .replace(BASE64_CANDIDATE_RE, (m) => (/\d/.test(m) ? '[redacted-token]' : m))
    .replace(DIGIT_RUN_RE, '[redacted-number]');
}

const VALUE_KEEPING_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

function stripControlValues(el: Element): void {
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (!VALUE_KEEPING_INPUT_TYPES.has(type)) el.removeAttribute('value');
  } else if (tag === 'TEXTAREA') {
    el.textContent = '';
  } else if (tag === 'OPTION') {
    el.removeAttribute('value');
  }
}

/**
 * Redact a detached tree in place, descending into `<template>` content
 * (where shadow-piercing capture puts shadow-root markup — TreeWalker does
 * not enter content fragments on its own).
 */
export function redactInPlace(root: Node): void {
  const doc = root.ownerDocument as Document;
  // SHOW_COMMENT matters: a secret in an HTML comment (`<!-- card 4111... -->`)
  // is serialized into domHtml by outerHTML and would otherwise ship to the
  // model unmasked — its format matches the redaction patterns, only its node
  // type was being skipped.
  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
  );
  const elements: Element[] = root.nodeType === 1 ? [root as Element] : [];
  const charData: CharacterData[] = []; // Text (3) and Comment (8) both expose .data
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) elements.push(node as Element);
    else charData.push(node as CharacterData);
  }
  for (const el of elements) {
    stripControlValues(el);
    for (const attr of Array.from(el.attributes)) {
      const masked = maskText(attr.value);
      if (masked !== attr.value) el.setAttribute(attr.name, masked);
    }
    if (el.tagName === 'TEMPLATE') redactInPlace((el as HTMLTemplateElement).content);
  }
  for (const node of charData) {
    const masked = maskText(node.data);
    if (masked !== node.data) node.data = masked;
  }
}

/**
 * Clone `root` (open shadow roots included as declarative templates) and
 * return redacted HTML. The live DOM is never mutated — this runs inside
 * the `fail` handler against the page under test.
 */
export function redactedOuterHtml(root: Element): string {
  const clone = cloneWithShadow(root);
  redactInPlace(clone);
  return clone.outerHTML;
}
