import { describe, expect, it } from 'vitest';
import { parseRepairReply, ReplyParseError } from '../src/heal/parse';
import { EditRejected, validateEdit } from '../src/heal/validate';
import { RepairReply } from '../src/heal/types';

const SPEC = `describe('cart', () => {
  it('adds', () => {
    cy.visit('/');
    cy.get('[data-testid="add-to-cart-5"]').click();
    cy.get('#cart-count').should('have.text', '1');
  });
});
`;
const SPEC_PATH = 'cypress/e2e/cart.cy.ts';

const reply = (oldString: string, newString: string, file = SPEC_PATH): RepairReply => ({
  edits: [{ file, oldString, newString }],
  confidence: 0.9,
  reasoning: 'selector drift',
});

describe('parseRepairReply', () => {
  it('accepts plain JSON', () => {
    const r = parseRepairReply('{"edits":[{"file":"a","oldString":"b","newString":"c"}],"confidence":0.8,"reasoning":"r"}');
    expect(r.edits).toHaveLength(1);
  });

  it('tolerates fenced JSON', () => {
    const r = parseRepairReply('```json\n{"giveUp":{"reason":"page never loaded"},"reasoning":"r"}\n```');
    expect(r.giveUp?.reason).toBe('page never loaded');
  });

  it('rejects prose', () => {
    expect(() => parseRepairReply('I think the selector should be...')).toThrow(ReplyParseError);
  });

  it('rejects out-of-range confidence', () => {
    expect(() =>
      parseRepairReply('{"edits":[{"file":"a","oldString":"b","newString":"c"}],"confidence":1.4}'),
    ).toThrow(ReplyParseError);
  });
});

describe('validateEdit', () => {
  it('accepts a selector-string change', () => {
    const edit = validateEdit(
      reply(`cy.get('[data-testid="add-to-cart-5"]')`, `cy.get('[data-testid="buy-now-5"]')`),
      SPEC_PATH,
      SPEC,
    );
    expect(edit.newString).toContain('buy-now-5');
  });

  it('rejects edits to any file but the failing spec', () => {
    expect(() =>
      validateEdit(reply('a', 'b', 'demo/js/shop.js'), SPEC_PATH, SPEC),
    ).toThrow(/only the failing spec/);
  });

  it('rejects multi-edit replies', () => {
    const r: RepairReply = { edits: [reply('a', 'b').edits![0], reply('c', 'd').edits![0]], confidence: 0.9 };
    expect(() => validateEdit(r, SPEC_PATH, SPEC)).toThrow(/exactly one edit/);
  });

  it('rejects oldString not present in the spec', () => {
    expect(() =>
      validateEdit(reply(`cy.get('#nope')`, `cy.get('#yep')`), SPEC_PATH, SPEC),
    ).toThrow(/not found/);
  });

  it('rejects ambiguous oldString', () => {
    expect(() => validateEdit(reply('cy.get', 'cy.contains'), SPEC_PATH, SPEC)).toThrow(EditRejected);
  });

  it('rejects changes outside a quoted string', () => {
    expect(() =>
      validateEdit(
        reply(`cy.get('#cart-count').should('have.text', '1')`, `cy.contains('#cart-count').should('have.text', '1')`),
        SPEC_PATH,
        SPEC,
      ),
    ).toThrow(/quoted selector string/);
  });

  it('rejects assertion edits — heals never weaken assertions', () => {
    expect(() =>
      validateEdit(
        reply(`.should('have.text', '1')`, `.should('exist', '1')`),
        SPEC_PATH,
        SPEC,
      ),
    ).toThrow(/never weaken assertions/);
  });

  it('rejects line-count changes', () => {
    expect(() =>
      validateEdit(
        reply(`cy.get('[data-testid="add-to-cart-5"]').click();`, `cy.get('[data-testid="x"]').click();\ncy.wait(500);`),
        SPEC_PATH,
        SPEC,
      ),
    ).toThrow(EditRejected);
  });
});
