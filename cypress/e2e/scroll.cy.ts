// Usage-catalog cluster: scrolling (item 14) — element-scoped scrollTo in a
// real overflow container.
describe('reviews scroll container', () => {
  it('reaches the last review by scrolling the container', () => {
    cy.visit('/');
    cy.get('#review-12').should('not.be.visible');
    cy.get('#reviews').scrollTo('bottom');
    cy.get('#review-12').should('be.visible').and('contain', 'The last review');
  });
});
