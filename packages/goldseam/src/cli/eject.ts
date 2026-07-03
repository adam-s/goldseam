// `goldseam eject` — render cached translations as plain Cypress code.
// Unlike the incumbent, ejecting costs nothing: pasted code heals through
// the normal capture → heal pipeline like any hand-written spec.

import { StepCommand } from '../shared/prompt-types';

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function renderCommand(cmd: StepCommand): string {
  switch (cmd.action) {
    case 'visit':
      return `cy.visit(${q(cmd.url)});`;
    case 'click':
    case 'dblclick':
      return `cy.get(${q(cmd.selector)}).${cmd.action}(${cmd.force ? '{ force: true }' : ''});`;
    case 'type':
      return `cy.get(${q(cmd.selector)}).type(${q(cmd.text)});`;
    case 'check':
    case 'uncheck':
      return `cy.get(${q(cmd.selector)}).${cmd.action}();`;
    case 'select':
      return `cy.get(${q(cmd.selector)}).select(${q(cmd.value)});`;
    case 'trigger':
      return `cy.get(${q(cmd.selector)}).trigger(${q(cmd.event)});`;
    case 'scrollTo':
      return cmd.selector
        ? `cy.get(${q(cmd.selector)}).scrollTo(${q(cmd.position)});`
        : `cy.scrollTo(${q(cmd.position)});`;
    case 'viewport':
      return `cy.viewport(${cmd.width}, ${cmd.height});`;
    case 'assert': {
      const subject = cmd.selector ? `cy.get(${q(cmd.selector)})` : `cy.contains(${q(cmd.contains as string)})`;
      const extra =
        cmd.value !== undefined
          ? `, ${typeof cmd.value === 'string' ? q(cmd.value) : cmd.value}`
          : cmd.selector && cmd.contains
            ? `, ${q(cmd.contains)}`
            : '';
      return `${subject}.should(${q(cmd.should)}${extra});`;
    }
    case 'wait':
      return `cy.wait(${cmd.ms});`;
  }
}

export function renderEntry(steps: string[], commands: StepCommand[]): string {
  const lines: string[] = [];
  for (const step of steps) lines.push(`// ${step}`);
  for (const cmd of commands) lines.push(renderCommand(cmd));
  return lines.join('\n');
}
