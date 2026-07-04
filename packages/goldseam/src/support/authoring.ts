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
import { PROMPT_LOAD_TASK, PROMPT_TRANSLATE_TASK } from '../shared/types';
import { maskText, redactedOuterHtml } from './redact';

export interface GoldseamPromptOptions {
  placeholders?: Record<string, string>;
}

function execute(commands: StepCommand[], placeholders: Record<string, string>): void {
  const fill = (text: string) => resolvePlaceholders(text, placeholders);
  // `shadow` scopes the selector inside a host's shadow root — the only
  // way to target "the header of the FIRST sl-details", since CSS has no
  // cross-boundary combinators.
  const target = (cmd: { selector: string; shadow?: string }) =>
    cmd.shadow ? cy.get(cmd.shadow).first().shadow().find(cmd.selector) : cy.get(cmd.selector);
  for (const cmd of commands) {
    switch (cmd.action) {
      case 'visit':
        cy.visit(fill(cmd.url));
        break;
      case 'click':
      case 'dblclick':
        target(cmd)[cmd.action]({ ...(cmd.force ? { force: true } : {}) });
        break;
      case 'type':
        target(cmd).type(fill(cmd.text));
        break;
      case 'check':
      case 'uncheck':
        target(cmd)[cmd.action]();
        break;
      case 'select':
        target(cmd).select(fill(cmd.value));
        break;
      case 'trigger':
        target(cmd).trigger(cmd.event);
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

    cy.task<PromptCacheEntry | null>(PROMPT_LOAD_TASK, { key }, { log: false }).then((cached) => {
      // Key is a 32-bit hash — confirm the steps themselves before trusting
      // the entry (collision or hand-renamed file ⇒ retranslate).
      if (cached && JSON.stringify(cached.steps) === JSON.stringify(steps)) {
        if (cached.giveUp) {
          // A cached refusal replays as a deterministic failure: same
          // steps, same answer, zero model calls.
          throw new Error(
            `goldseam: these steps were declined as ambiguous: ${cached.giveUp.reason} — edit the steps (new steps retranslate) or delete the cache entry`,
          );
        }
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
        };
        cy.task<PromptCacheEntry>(PROMPT_TRANSLATE_TASK, payload, {
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
