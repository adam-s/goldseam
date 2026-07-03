import { describe, expect, it } from 'vitest';
import { parseRepairReply, ReplyParseError } from '../src/heal/parse';
import { EditRejected, validateEdits } from '../src/heal/validate';
import { RepairEdit, RepairReply } from '../src/heal/types';

const SPEC = `describe('cart', () => {
  it('adds', () => {
    cy.visit('/');
    cy.get('[data-testid="add-to-cart-5"]').click();
    cy.get('#cart-count').should('have.text', '1');
  });
  it('shows the count', () => {
    cy.get('[data-testid="add-to-cart-5"]').dblclick();
    cy.get('#cart-count').should('have.text', '2');
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

describe('validateEdits', () => {
  it('accepts a selector-string change', () => {
    const edits = validateEdits(
      reply(`cy.get('[data-testid="add-to-cart-5"]').click();`, `cy.get('[data-testid="buy-now-5"]').click();`),
      SPEC_PATH,
      SPEC,
    );
    expect(edits[0].newString).toContain('buy-now-5');
  });

  it('accepts multiple edits — one per occurrence of a repeated selector', () => {
    const r: RepairReply = {
      edits: [
        {
          file: SPEC_PATH,
          oldString: `cy.get('[data-testid="add-to-cart-5"]').click();`,
          newString: `cy.get('[data-testid="buy-now-5"]').click();`,
        },
        {
          file: SPEC_PATH,
          oldString: `cy.get('[data-testid="add-to-cart-5"]').dblclick();`,
          newString: `cy.get('[data-testid="buy-now-5"]').dblclick();`,
        },
      ],
      confidence: 0.9,
    };
    expect(validateEdits(r, SPEC_PATH, SPEC)).toHaveLength(2);
  });

  it('rejects duplicate oldStrings across edits', () => {
    const edit: RepairEdit = {
      file: SPEC_PATH,
      oldString: `cy.get('[data-testid="add-to-cart-5"]').click();`,
      newString: `cy.get('[data-testid="buy-now-5"]').click();`,
    };
    expect(() => validateEdits({ edits: [edit, { ...edit }], confidence: 0.9 }, SPEC_PATH, SPEC)).toThrow(
      /duplicate oldString/,
    );
  });

  it('rejects more than 8 edits as non-minimal', () => {
    const edits = Array.from({ length: 9 }, (_, i) => ({
      file: SPEC_PATH,
      oldString: `x${i}`,
      newString: `y${i}`,
    }));
    expect(() => validateEdits({ edits, confidence: 0.9 }, SPEC_PATH, SPEC)).toThrow(/not a minimal heal/);
  });

  it('rejects edits to any file but the failing spec', () => {
    expect(() =>
      validateEdits(reply('a', 'b', 'demo/js/shop.js'), SPEC_PATH, SPEC),
    ).toThrow(/only the failing spec/);
  });

  it('rejects oldString not present in the spec', () => {
    expect(() =>
      validateEdits(reply(`cy.get('#nope')`, `cy.get('#yep')`), SPEC_PATH, SPEC),
    ).toThrow(/not found/);
  });

  it('rejects ambiguous oldString', () => {
    expect(() => validateEdits(reply('cy.get', 'cy.contains'), SPEC_PATH, SPEC)).toThrow(EditRejected);
  });

  it('rejects changes outside a quoted string', () => {
    expect(() =>
      validateEdits(
        reply(`cy.get('#cart-count').should('have.text', '1')`, `cy.contains('#cart-count').should('have.text', '1')`),
        SPEC_PATH,
        SPEC,
      ),
    ).toThrow(/quoted selector string/);
  });

  it('rejects assertion edits — heals never weaken assertions', () => {
    expect(() =>
      validateEdits(
        reply(`.should('have.text', '1')`, `.should('exist', '1')`),
        SPEC_PATH,
        SPEC,
      ),
    ).toThrow(/never weaken assertions/);
  });

  it('accepts a selector rename whose diff fragment is an assertion-like word (context wins)', () => {
    // '#cart-count' → '#cart-value': the changed core is "value", but the
    // change lives inside cy.get() — a legitimate selector edit. This was
    // a real benchmark false positive.
    const edits = validateEdits(
      reply(`cy.get('#cart-count').should('have.text', '1');`, `cy.get('#cart-value').should('have.text', '1');`),
      SPEC_PATH,
      SPEC,
    );
    expect(edits[0].newString).toContain('#cart-value');
  });

  it('rejects assertion-word changes when the snippet has no call context', () => {
    const spec = `cy.get('#a').should('have.text', 'x');\n`;
    expect(() =>
      validateEdits(reply(`'have.text'`, `'have.value'`), SPEC_PATH, spec),
    ).toThrow(/never weaken assertions/);
  });

  it('rejects line-count changes', () => {
    expect(() =>
      validateEdits(
        reply(
          `cy.get('[data-testid="add-to-cart-5"]').click();`,
          `cy.get('[data-testid="x"]').click();\ncy.wait(500);`,
        ),
        SPEC_PATH,
        SPEC,
      ),
    ).toThrow(EditRejected);
  });
});
