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
};

process.stdin.on('end', () => {
  console.log(JSON.stringify(REPLIES[mode]));
});
