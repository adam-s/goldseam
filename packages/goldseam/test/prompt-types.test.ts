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

  it('keys on the token text, not a substituted value (values never collapse into the token)', () => {
    // The key is derived from the step text WITH `{{pwd}}` intact; a step
    // carrying a literal value is a different step and must key differently.
    // This is what lets the same authored steps share one cache entry no
    // matter what a placeholder resolves to at runtime.
    expect(promptKey(['Type {{pwd}} in password'])).not.toBe(promptKey(['Type hunter2 in password']));
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

  it('honors shadow scoping — ejected code targets the SAME element replay does', () => {
    // The executor resolves a shadow-scoped selector inside the first host's
    // shadow root; eject must render the identical form, not a bare cy.get
    // that would target a different element (or nothing).
    const code = renderEntry(
      ['Open the first details panel'],
      [{ action: 'click', selector: "[part='header']", shadow: 'sl-details:first-of-type', force: true }],
    );
    expect(code).toContain(
      `cy.get('sl-details:first-of-type').first().shadow().find('[part=\\'header\\']').click({ force: true });`,
    );
    // Without a shadow field it stays the plain form (no regression).
    const plain = renderEntry(['t'], [{ action: 'type', selector: '#name', text: 'hi' }]);
    expect(plain).toContain(`cy.get('#name').type('hi');`);
    expect(plain).not.toContain('.shadow()');
  });

  it('renders a DECLINED translation as a loud throw, never an empty passing block', () => {
    // A cached refusal replays as a thrown error (give-up is first-class).
    // Ejected, it must fail the same way — an empty command list would paste
    // as a silently-passing block: a refusal misreported as success.
    const code = renderEntry(['do something vague'], [], { reason: 'no element matches "the thing"' });
    expect(code).toContain('// do something vague');
    expect(code).toContain('goldseam DECLINED these steps as ambiguous');
    expect(code).toContain('no element matches');
    expect(code).toMatch(/throw new Error\('goldseam declined these steps as ambiguous:/);
    // The refusal is not silently swallowed as an inert comment-only body.
    expect(code).toContain('throw new Error(');
  });

  it('a text expectation paired with a non-text chainer becomes a REAL assertion (false-green fix)', () => {
    // should('be.visible', 'ordered!') silently ignores the second arg in
    // Chai — the fresh-consumer walkthrough proved an app showing the
    // WRONG text stayed green. Both the executor and eject must chain an
    // explicit contain.text instead.
    const code = renderEntry(
      ['The status should say ordered!'],
      [{ action: 'assert', selector: '#status', contains: 'ordered!', should: 'be.visible' }],
    );
    expect(code).toContain(`cy.get('#status').should('be.visible').and('contain.text', 'ordered!');`);
    // Text-consuming chainers keep the argument form.
    const textCode = renderEntry(
      ['The status should say ordered!'],
      [{ action: 'assert', selector: '#status', contains: 'ordered!', should: 'contain.text' }],
    );
    expect(textCode).toContain(`cy.get('#status').should('contain.text', 'ordered!');`);
  });

  it('accepts shadow-scoped interactions and rejects empty hosts (Shoelace proving)', () => {
    expect(
      validateCommands([
        { action: 'click', selector: "[part='header']", shadow: 'sl-details:first-of-type', force: true },
      ]),
    ).toHaveLength(1);
    expect(() =>
      validateCommands([{ action: 'click', selector: 'x', shadow: '' }]),
    ).toThrow(/shadow must be a non-empty selector/);
  });
});
