// Usage-catalog cluster: appear/disappear (item 21) — both not.exist
// temporal flavors: never-existed, and existed-then-removed.
describe('terms modal', () => {
  beforeEach(() => cy.visit('/checkout.html'));

  it('never shows an error banner (never-existed flavor)', () => {
    cy.get('.major-error').should('not.exist');
  });

  it('opens on the terms link and closes back to not.exist', () => {
    cy.get('.modal').should('not.exist');
    cy.get('#terms-link').click();
    cy.get('.modal').should('be.visible').and('contain', 'No refunds on figments');
    cy.get('.modal-close').click();
    cy.get('.modal').should('not.exist');
  });
});
