// Probe: the failure happens inside a cy.origin block (second origin =
// same host, different port). Question: what does the capture contain —
// the cross-origin DOM, the primary DOM, or a degraded capture?
describe('cross-origin failure', () => {
  it('fails inside cy.origin', () => {
    cy.visit('/');
    cy.origin('http://localhost:4174', () => {
      cy.visit('http://localhost:4174/product.html?id=2');
      cy.get('#does-not-exist', { timeout: 1000 });
    });
  });
});
