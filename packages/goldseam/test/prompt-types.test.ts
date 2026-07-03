import { describe, expect, it } from 'vitest';
import {
  InvalidTranslation,
  promptKey,
  resolvePlaceholders,
  validateCommands,
} from '../src/shared/prompt-types';
import { renderEntry } from '../src/cli/eject';

describe('promptKey', () => {
  it('is stable for identical steps and differs otherwise', () => {
    expect(promptKey(['a', 'b'])).toBe(promptKey(['a', 'b']));
    expect(promptKey(['a', 'b'])).not.toBe(promptKey(['a', 'c']));
  });

  it('placeholder VALUES do not affect identity (tokens are part of the text)', () => {
    expect(promptKey(['Type {{pwd}} in password'])).toBe(promptKey(['Type {{pwd}} in password']));
  });
});

describe('validateCommands', () => {
  it('accepts the full vocabulary', () => {
    const cmds = validateCommands([
      { action: 'visit', url: '/' },
      { action: 'click', selector: '#a', force: true },
      { action: 'type', selector: '#b', text: '{{name}}' },
      { action: 'trigger', selector: '#c', event: 'mouseenter' },
      { action: 'assert', contains: 'Hello', should: 'be.visible' },
      { action: 'viewport', width: 360, height: 640 },
      { action: 'wait', ms: 100 },
    ]);
    expect(cmds).toHaveLength(7);
  });

  it('rejects unknown actions and missing fields', () => {
    expect(() => validateCommands([{ action: 'eval', code: 'x' }])).toThrow(InvalidTranslation);
    expect(() => validateCommands([{ action: 'click' }])).toThrow(/selector/);
    expect(() => validateCommands([{ action: 'assert', should: 'exist' }])).toThrow(/selector or contains/);
    expect(() => validateCommands([])).toThrow(InvalidTranslation);
  });
});

describe('resolvePlaceholders', () => {
  it('substitutes known tokens and leaves unknown ones intact', () => {
    expect(resolvePlaceholders('hi {{name}} ({{missing}})', { name: 'Ada' })).toBe('hi Ada ({{missing}})');
  });
});

describe('renderEntry (eject)', () => {
  it('renders steps as comments and commands as Cypress code', () => {
    const code = renderEntry(
      ['Add the mug', 'Check the count'],
      [
        { action: 'click', selector: '[data-testid="add-to-cart-5"]' },
        { action: 'assert', selector: '#cart-count', should: 'have.text', value: '1' },
      ],
    );
    expect(code).toContain('// Add the mug');
    expect(code).toContain(`cy.get('[data-testid="add-to-cart-5"]').click();`);
    expect(code).toContain(`cy.get('#cart-count').should('have.text', '1');`);
  });
});
