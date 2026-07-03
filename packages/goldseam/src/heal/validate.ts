// Mechanical enforcement of the heal invariants. A proposal that fails any
// rule is rejected before it touches disk — the model is never trusted to
// follow the rules, only asked to.

import { RepairEdit, RepairReply } from './types';

export class EditRejected extends Error {}

/** Words that indicate the change touched an assertion, not a selector. */
const ASSERTION_CORE = /^(not\.)?(have|be|contain|exist|match|include|eq|equal|length|visible|enabled|disabled|checked|text|value|attr|class|css)\b/;

function changedSpan(oldString: string, newString: string): { oldCore: string; newCore: string; prefix: string } {
  let p = 0;
  while (p < oldString.length && p < newString.length && oldString[p] === newString[p]) p++;
  let s = 0;
  while (
    s < oldString.length - p &&
    s < newString.length - p &&
    oldString[oldString.length - 1 - s] === newString[newString.length - 1 - s]
  ) s++;
  return {
    oldCore: oldString.slice(p, oldString.length - s),
    newCore: newString.slice(p, newString.length - s),
    prefix: oldString.slice(0, p),
  };
}

/** The quote char enclosing `index` in `code`, or null if outside any
 * string. Attribute selectors nest a different quote inside (`'[a="b"]'`),
 * so we track the OUTER delimiter specifically. */
function enclosingQuote(code: string, index: number): string | null {
  let quote: string | null = null;
  for (let i = 0; i < index; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    }
  }
  return quote;
}

/** Name of the innermost call whose parentheses enclose `index` — e.g. in
 * `cy.get('#x').should('have.text', '1')` position of `have.text` returns
 * "should". Undefined when the snippet carries no call context. */
function enclosingCallName(code: string, index: number): string | undefined {
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < index; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') {
      const name = code.slice(0, i).match(/([\w$]+)\s*$/);
      stack.push(name ? name[1] : '?');
    } else if (ch === ')') stack.pop();
  }
  return stack[stack.length - 1];
}

const ASSERTION_CALLS = new Set(['should', 'and', 'expect', 'assert']);

/** Real specs reference a selector several times; each occurrence needs its
 * own exact-string edit. The cap is a minimality guard, not a feature. */
const MAX_EDITS = 8;

export function validateEdits(reply: RepairReply, specPath: string, specSource: string): RepairEdit[] {
  const edits = reply.edits ?? [];
  if (edits.length === 0) throw new EditRejected('at least one edit required');
  if (edits.length > MAX_EDITS) {
    throw new EditRejected(`${edits.length} edits proposed; more than ${MAX_EDITS} is not a minimal heal`);
  }
  const seen = new Set<string>();
  for (const edit of edits) {
    if (seen.has(edit.oldString)) {
      throw new EditRejected('duplicate oldString across edits');
    }
    seen.add(edit.oldString);
    validateSingleEdit(edit, specPath, specSource);
  }
  return edits;
}

function validateSingleEdit(edit: RepairEdit, specPath: string, specSource: string): RepairEdit {
  if (edit.file !== specPath) {
    throw new EditRejected(`edit targets ${edit.file}; only the failing spec (${specPath}) may be edited`);
  }
  if (edit.oldString === edit.newString) {
    throw new EditRejected('oldString and newString are identical');
  }

  const occurrences = specSource.split(edit.oldString).length - 1;
  if (occurrences === 0) {
    throw new EditRejected('oldString not found in the spec source');
  }
  if (occurrences > 1) {
    throw new EditRejected(`oldString is ambiguous (${occurrences} occurrences); provide more context`);
  }

  const { oldCore, newCore, prefix } = changedSpan(edit.oldString, edit.newString);

  // Bare-string edits (cache tier: oldString IS the selector text, no
  // quotes in the snippet): validate against the spec's surrounding
  // characters instead — the occurrence must be a complete quoted string,
  // not an assertion argument, and the replacement must not break out of
  // the quotes.
  if (!/['"`]/.test(edit.oldString)) {
    const pos = specSource.indexOf(edit.oldString);
    const open = specSource[pos - 1];
    const close = specSource[pos + edit.oldString.length];
    if (!(open === "'" || open === '"' || open === '`') || close !== open) {
      throw new EditRejected('the change must be confined to a quoted selector string');
    }
    if (/['"`]|\$\{/.test(edit.newString)) {
      throw new EditRejected('replacement must stay inside the quoted string');
    }
    const lead = specSource.slice(Math.max(0, pos - 40), pos - 1);
    if (/(should|and|expect|assert)\s*\(\s*$/.test(lead)) {
      throw new EditRejected('the change is inside an assertion; heals never weaken assertions');
    }
    return edit;
  }

  const oldQuote = enclosingQuote(edit.oldString, prefix.length);
  const newQuote = enclosingQuote(edit.newString, prefix.length);
  if (oldQuote === null || newQuote === null) {
    throw new EditRejected('the change must be confined to a quoted selector string');
  }
  // The changed span is one contiguous region, but it can STRADDLE strings
  // (e.g. '#a')…('1' → '#b')…('2' spans a selector AND an assertion value).
  // A core containing the OUTER delimiter closed one string and opened
  // another — reject. Inner quotes of an attribute selector
  // (`'[data-testid="x"]'` → `'[role="grid"]'`) are a DIFFERENT char than
  // the outer `'`, so they pass. (Red-team CRITICAL; refined after the
  // PrairieLearn proving ground flagged a legit data-testid→role heal.)
  const outer = oldQuote;
  if (oldCore.includes(outer) || newCore.includes(newQuote) || /\$\{/.test(oldCore + newCore)) {
    throw new EditRejected('the change spans more than one quoted string; one edit per selector site');
  }
  // Context beats fragments: a change inside .should()/.and()/expect() is
  // an assertion edit no matter what it says; a change inside cy.get() is
  // a selector edit even when the diff fragment is a word like "value".
  const call = enclosingCallName(edit.oldString, prefix.length);
  if (call && ASSERTION_CALLS.has(call)) {
    throw new EditRejected(`the change is inside ${call}(…); heals never weaken assertions`);
  }
  if (!call && (ASSERTION_CORE.test(oldCore) || ASSERTION_CORE.test(newCore))) {
    // No call context in the snippet — fall back to the fragment check.
    throw new EditRejected(`the change looks like an assertion edit ("${oldCore}" → "${newCore}"); heals never weaken assertions`);
  }
  if (edit.newString.split('\n').length !== edit.oldString.split('\n').length) {
    throw new EditRejected('the edit may not add or remove lines');
  }

  return edit;
}
