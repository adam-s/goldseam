// `cy.goldseam(steps, { placeholders })` — the authoring half of parity
// with cy.prompt, minus the vendor cloud:
//
// - steps translate ONCE (via your model) into a constrained command list;
//   the executor below maps commands to plain cy.* calls — generated code
//   is never evaluated.
// - translations cache in `.goldseam-prompts/` — committable, reviewable,
//   shared through git instead of a vendor cloud.
// - `{{placeholder}}` values substitute at execution time only; they never
//   reach the model and never affect cache identity.

import {
  PromptCacheEntry,
  StepCommand,
  promptKey,
  resolvePlaceholders,
} from '../shared/prompt-types';
import { maskText, redactedOuterHtml } from './redact';

export interface GoldseamPromptOptions {
  placeholders?: Record<string, string>;
}

function execute(commands: StepCommand[], placeholders: Record<string, string>): void {
  const fill = (text: string) => resolvePlaceholders(text, placeholders);
  for (const cmd of commands) {
    switch (cmd.action) {
      case 'visit':
        cy.visit(fill(cmd.url));
        break;
      case 'click':
      case 'dblclick':
        cy.get(cmd.selector)[cmd.action]({ ...(cmd.force ? { force: true } : {}) });
        break;
      case 'type':
        cy.get(cmd.selector).type(fill(cmd.text));
        break;
      case 'check':
      case 'uncheck':
        cy.get(cmd.selector)[cmd.action]();
        break;
      case 'select':
        cy.get(cmd.selector).select(fill(cmd.value));
        break;
      case 'trigger':
        cy.get(cmd.selector).trigger(cmd.event);
        break;
      case 'scrollTo':
        if (cmd.selector) cy.get(cmd.selector).scrollTo(cmd.position as Cypress.PositionType);
        else cy.scrollTo(cmd.position as Cypress.PositionType);
        break;
      case 'viewport':
        cy.viewport(cmd.width, cmd.height);
        break;
      case 'assert': {
        const subject = cmd.selector ? cy.get(cmd.selector) : cy.contains(fill(cmd.contains as string));
        if (cmd.value !== undefined) {
          subject.should(cmd.should, typeof cmd.value === 'string' ? fill(cmd.value) : cmd.value);
        } else if (cmd.selector && cmd.contains) {
          subject.should(cmd.should, fill(cmd.contains));
        } else {
          subject.should(cmd.should);
        }
        break;
      }
      case 'wait':
        cy.wait(cmd.ms);
        break;
    }
  }
}

export function registerAuthoringCommand(): void {
  Cypress.Commands.add('goldseam', (steps: string[], options: GoldseamPromptOptions = {}) => {
    const key = promptKey(steps);
    const placeholders = options.placeholders ?? {};

    cy.task<PromptCacheEntry | null>('goldseam:prompt:load', { key }, { log: false }).then((cached) => {
      if (cached) {
        execute(cached.commands, placeholders);
        return;
      }
      // First run: translate against the live page. The DOM ships redacted,
      // exactly like a failure capture.
      cy.document({ log: false }).then((doc) => {
        const payload = {
          key,
          steps,
          url: maskText(doc.location.href),
          domHtml: redactedOuterHtml(doc.documentElement),
          ariaSnapshot: '',
        };
        cy.task<PromptCacheEntry>('goldseam:prompt:translate', payload, {
          log: false,
          timeout: 120_000,
        }).then((entry) => execute(entry.commands, placeholders));
      });
    });
  });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Natural-language steps, translated once by your model, cached in
       * `.goldseam-prompts/`, executed as plain Cypress commands. */
      goldseam(steps: string[], options?: GoldseamPromptOptions): Chainable<void>;
    }
  }
}
