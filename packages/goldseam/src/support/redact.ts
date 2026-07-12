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

/** aria-snapshot renders a text control's typed value inline after its role
 * and accessible name — `- textbox "Full name": <value>`. That value is user
 * input (passwords, PII); the DOM path already strips it (stripControlValues),
 * but the aria path went through maskText only, which PATTERN-masks and does
 * not strip form values, so a value matching no pattern leaked to the model —
 * breaking the documented "text-entry values are never captured" guarantee.
 * Drop the inline value, keep the role and accessible name. Runs BEFORE
 * maskText so the value never reaches it. Line-based: form-control values are
 * single-line; a structural `role:` with indented children has nothing inline
 * after the colon and is left untouched. */
const ARIA_TEXT_CONTROL_VALUE =
  /^(\s*-\s+(?:textbox|searchbox|spinbutton|combobox|slider)(?:\s+"(?:[^"\\]|\\.)*")?):\s+\S.*$/;
export function stripAriaControlValues(yaml: string): string {
  return yaml
    .split('\n')
    .map((line) => line.replace(ARIA_TEXT_CONTROL_VALUE, '$1'))
    .join('\n');
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
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const elements: Element[] = root.nodeType === 1 ? [root as Element] : [];
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) elements.push(node as Element);
    else textNodes.push(node as Text);
  }
  for (const el of elements) {
    stripControlValues(el);
    for (const attr of Array.from(el.attributes)) {
      const masked = maskText(attr.value);
      if (masked !== attr.value) el.setAttribute(attr.name, masked);
    }
    if (el.tagName === 'TEMPLATE') redactInPlace((el as HTMLTemplateElement).content);
  }
  for (const text of textNodes) {
    const masked = maskText(text.data);
    if (masked !== text.data) text.data = masked;
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
