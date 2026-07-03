// Probe: the failure happens inside beforeEach, not the test body.
// Question: does our afterEach still run (artifact written) or is the
// capture lost?
describe('hook failure', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('#does-not-exist', { timeout: 500 });
  });

  it('never reaches the test body', () => {
    cy.contains('Demo Shop');
  });
});
