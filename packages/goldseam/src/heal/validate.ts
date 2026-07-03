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

/** Is position `index` inside a quoted region of `code`? Naive but effective for spec snippets. */
function insideQuotes(code: string, index: number): boolean {
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
  return quote !== null;
}

export function validateEdit(reply: RepairReply, specPath: string, specSource: string): RepairEdit {
  const edits = reply.edits ?? [];
  if (edits.length !== 1) {
    throw new EditRejected(`exactly one edit required, got ${edits.length}`);
  }
  const edit = edits[0];

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
  if (!insideQuotes(edit.oldString, prefix.length) || !insideQuotes(edit.newString, prefix.length)) {
    throw new EditRejected('the change must be confined to a quoted selector string');
  }
  if (ASSERTION_CORE.test(oldCore) || ASSERTION_CORE.test(newCore)) {
    throw new EditRejected(`the change looks like an assertion edit ("${oldCore}" → "${newCore}"); heals never weaken assertions`);
  }
  if (edit.newString.split('\n').length !== edit.oldString.split('\n').length) {
    throw new EditRejected('the edit may not add or remove lines');
  }

  return edit;
}
