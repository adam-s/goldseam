// System-test fixture: deliberately broken selector. Outside the default
// specPattern; run via `npm run cy:run:broken` or scripts/system-test.mjs,
// which asserts a schema-valid capture artifact appears.
describe('broken selector fixture', () => {
  it('fails on a selector that does not exist', () => {
    cy.visit('/');
    cy.get('[data-cy="does-not-exist"]', { timeout: 2000 }).should('be.visible');
  });
});
