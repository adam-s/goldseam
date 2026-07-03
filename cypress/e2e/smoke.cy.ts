// Smoke test: proves the toolchain runs against the local demo shop, and
// that a green run stays quiet (asserted by scripts/system-test.mjs).
describe('smoke', () => {
  it('runs Cypress end to end', () => {
    cy.visit('/');
    cy.contains('Demo Shop');
  });
});
