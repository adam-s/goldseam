// Probe: the user registers their own fail handler (spec-level, so AFTER
// ours) that swallows the error — a documented community pattern for
// expected failures. Questions: does our re-throw preempt the user's
// swallow (changing their suite's semantics)? What does the run report?
Cypress.on('fail', () => {
  // swallow: user considers this failure expected
  return false as unknown as void;
});

describe('user swallow handler', () => {
  it('user expects this failure to be swallowed', () => {
    cy.visit('/');
    cy.get('#does-not-exist', { timeout: 500 });
  });
});
