// Probe: a test that fails every attempt with retries on.
// Question: exactly one artifact, or one per attempt?
describe('retry always fails', { retries: 1 }, () => {
  it('fails on every attempt', () => {
    cy.visit('/');
    cy.get('#does-not-exist', { timeout: 500 }).should('exist');
  });
});
