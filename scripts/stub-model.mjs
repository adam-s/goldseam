// Deterministic stand-in for a repair model (used via --model "cmd:node
// scripts/stub-model.mjs <mode>"). Keeps the heal E2E test model-free and
// CI-safe; the engine can't tell the difference — that's the point of the
// RepairRunner interface.
process.stdin.resume(); // consume the prompt; replies are fixed by mode

const mode = process.argv[2] ?? 'fix';

const REPLIES = {
  fix: {
    edits: [
      {
        file: 'cypress/system/tmp-healable.cy.ts',
        oldString: `'[data-testid="buy-now-5"]'`,
        newString: `'[data-testid="add-to-cart-5"]'`,
      },
    ],
    confidence: 0.95,
    reasoning: 'The add-to-cart button for product 5 carries data-testid="add-to-cart-5"; "buy-now-5" does not exist in the captured DOM.',
  },
  giveup: {
    giveUp: { reason: 'no element in the capture plausibly matches the broken selector' },
    reasoning: 'Nothing in the DOM or aria tree resembles the target.',
  },
  // cy.goldseam translation for the demo flow, {{qty}} passed through as a
  // placeholder token (its value must never appear in the cache).
  translate: {
    commands: [
      { action: 'visit', url: '/' },
      { action: 'click', selector: '[data-testid="add-to-cart-5"]' },
      { action: 'assert', selector: '#cart-count', should: 'have.text', value: '{{qty}}' },
    ],
  },
  // Repeated selector: one edit per occurrence, each made unique by its
  // surrounding call chain.
  multi: {
    edits: [
      {
        file: 'cypress/system/tmp-healable.cy.ts',
        oldString: `cy.get('[data-testid="buy-now-5"]', { timeout: 2000 }).click();`,
        newString: `cy.get('[data-testid="add-to-cart-5"]', { timeout: 2000 }).click();`,
      },
      {
        file: 'cypress/system/tmp-healable.cy.ts',
        oldString: `cy.get('[data-testid="buy-now-5"]').should('not.be.disabled');`,
        newString: `cy.get('[data-testid="add-to-cart-5"]').should('not.be.disabled');`,
      },
    ],
    confidence: 0.93,
    reasoning: 'The same drifted selector appears twice; both occurrences point at the add-to-cart button.',
  },
  // Plausible-but-wrong: passes every mechanical validation (single quoted
  // selector-string change) but points at an element that does not exist —
  // only the rerun rungs can reject it. Proves the ladder has teeth.
  wrong: {
    edits: [
      {
        file: 'cypress/system/tmp-healable.cy.ts',
        oldString: `'[data-testid="buy-now-5"]'`,
        newString: `'[data-testid="add-to-basket-5"]'`,
      },
    ],
    confidence: 0.9,
    reasoning: 'Plausible-looking selector that matches nothing on the page.',
  },
};

process.stdin.on('end', () => {
  console.log(JSON.stringify(REPLIES[mode]));
});
