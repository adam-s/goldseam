// Probe: a flaky test (fails attempt 0, passes attempt 1) with retries on.
// Question: does the fail event fire on non-final attempts and leave a
// stale artifact even though the test ultimately passes?
describe('retry flaky', { retries: 2 }, () => {
  it('fails first attempt then passes', () => {
    cy.visit('/');
    if (Cypress.currentRetry === 0) {
      cy.get('#does-not-exist', { timeout: 500 }).should('exist');
    } else {
      cy.contains('Demo Shop');
    }
  });
});
