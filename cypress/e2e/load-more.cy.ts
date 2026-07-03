// Usage-catalog cluster: network-backed actions (items 23–25) — intercept,
// wait, and assert on the request the click triggers.
describe('load more (XHR-backed)', () => {
  it('fetches extra products and disables itself', () => {
    cy.intercept('GET', '**/data/more-products.json').as('moreProducts');
    cy.visit('/');
    cy.get('.product-card').should('have.length', 6);
    cy.get('#load-more').click();
    cy.wait('@moreProducts').its('response.statusCode').should('eq', 200);
    cy.get('.product-card').should('have.length', 8);
    cy.contains('.product-card', 'Glacier Shelf').should('be.visible');
    cy.get('#load-more').should('be.disabled').and('contain', 'All products loaded');
  });

  it('loaded products respect active filters', () => {
    cy.visit('/');
    cy.get('.filter-box input[value="furniture"]').check();
    cy.get('#load-more').click();
    cy.get('.product-card:visible').should('have.length', 4);
  });
});
