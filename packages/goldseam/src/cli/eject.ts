// `goldseam eject` — render cached translations as plain Cypress code.
// Unlike the incumbent, ejecting costs nothing: pasted code heals through
// the normal capture → heal pipeline like any hand-written spec.

import { StepCommand, isTextAssertion } from '../shared/prompt-types';

const q = (s: string) =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;

/** A single-line `// comment`. A step or a model refusal reason is free text
 * that may contain newlines; emitted raw, a newline would split the comment
 * into a second, UNCOMMENTED line — a syntax error in the pasted spec
 * (red-team finding). Collapse all newlines to spaces so the comment stays one
 * line. */
const comment = (s: string): string => `// ${String(s).replace(/\s*[\r\n]+\s*/g, ' ')}`;

/** The subject expression for a selector, honoring `shadow` EXACTLY as the
 * executor does (authoring.ts `target`): a shadow-scoped selector resolves
 * inside the FIRST matching host's shadow root, since CSS has no
 * cross-boundary combinator. Ejecting bare `cy.get(selector)` here would
 * silently target a different element than replay — a fidelity break. */
const target = (selector: string, shadow?: string): string =>
  shadow ? `cy.get(${q(shadow)}).first().shadow().find(${q(selector)})` : `cy.get(${q(selector)})`;

export function renderCommand(cmd: StepCommand): string {
  switch (cmd.action) {
    case 'visit':
      return `cy.visit(${q(cmd.url)});`;
    case 'click':
    case 'dblclick':
      return `${target(cmd.selector, cmd.shadow)}.${cmd.action}(${cmd.force ? '{ force: true }' : ''});`;
    case 'type':
      return `${target(cmd.selector, cmd.shadow)}.type(${q(cmd.text)});`;
    case 'check':
    case 'uncheck':
      return `${target(cmd.selector, cmd.shadow)}.${cmd.action}();`;
    case 'select':
      return `${target(cmd.selector, cmd.shadow)}.select(${q(cmd.value)});`;
    case 'trigger':
      return `${target(cmd.selector, cmd.shadow)}.trigger(${q(cmd.event)});`;
    case 'scrollTo':
      return cmd.selector
        ? `cy.get(${q(cmd.selector)}).scrollTo(${q(cmd.position)});`
        : `cy.scrollTo(${q(cmd.position)});`;
    case 'viewport':
      return `cy.viewport(${cmd.width}, ${cmd.height});`;
    case 'assert': {
      const subject = cmd.selector ? `cy.get(${q(cmd.selector)})` : `cy.contains(${q(cmd.contains as string)})`;
      if (cmd.value !== undefined) {
        return `${subject}.should(${q(cmd.should)}, ${typeof cmd.value === 'string' ? q(cmd.value) : cmd.value});`;
      }
      if (cmd.selector && cmd.contains) {
        // Mirror the executor: a text expectation paired with a non-text
        // chainer must become a real contain.text assertion, not an inert
        // second argument Chai ignores.
        return isTextAssertion(cmd.should)
          ? `${subject}.should(${q(cmd.should)}, ${q(cmd.contains)});`
          : `${subject}.should(${q(cmd.should)}).and('contain.text', ${q(cmd.contains)});`;
      }
      return `${subject}.should(${q(cmd.should)});`;
    }
    case 'wait':
      return `cy.wait(${cmd.ms});`;
  }
}

export function renderEntry(
  steps: string[],
  commands: StepCommand[],
  giveUp?: { reason: string },
): string {
  const lines: string[] = [];
  // Tolerate a shape-corrupt cache entry (valid JSON, missing steps/commands):
  // eject must skip it, never throw a TypeError that aborts the whole run
  // (red-team finding — the JSON.parse guard alone didn't cover shape).
  for (const step of steps ?? []) lines.push(comment(step));
  // A cached refusal has no commands. Replay throws on it (give-up is
  // first-class); ejected code must too, or a declined translation would
  // paste as an empty, silently-passing block — a refusal misreported as
  // success. Emit the same loud failure, not a comment the runner ignores.
  if (giveUp) {
    lines.push(
      comment('goldseam DECLINED these steps as ambiguous — it refused to guess.'),
      comment(`Reason: ${giveUp.reason}`),
      comment('Rewrite the steps to be unambiguous (they retranslate), or drop them.'),
      `throw new Error(${q(`goldseam declined these steps as ambiguous: ${giveUp.reason}`)});`,
    );
    return lines.join('\n');
  }
  for (const cmd of commands ?? []) lines.push(renderCommand(cmd));
  return lines.join('\n');
}
