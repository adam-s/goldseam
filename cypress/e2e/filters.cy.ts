// Usage-catalog cluster: collections (items 11, 18, 19) — checkbox-group
// filtering, count assertions, order/first/last assertions.
describe('product filters', () => {
  beforeEach(() => cy.visit('/'));

  it('shows all products with no filter', () => {
    cy.get('.product-card:visible').should('have.length', 6);
  });

  it('filters by one category with correct count and order', () => {
    cy.get('.filter-box input[value="furniture"]').check();
    cy.get('.product-card:visible').should('have.length', 2);
    cy.get('.product-card:visible').first().should('contain', 'Birch Desk');
    cy.get('.product-card:visible').last().should('contain', 'Fjord Chair');
  });

  it('unions multiple checked categories', () => {
    cy.get('.filter-box input[value="furniture"]').check();
    cy.get('.filter-box input[value="kitchen"]').check();
    cy.get('.product-card:visible').should('have.length', 4);
  });

  it('checking every checkbox shows everything (multi-element action)', () => {
    cy.get('.filter-box input[type="checkbox"]').check();
    cy.get('.filter-box input[type="checkbox"]:checked').should('have.length', 4);
    cy.get('.product-card:visible').should('have.length', 6);
  });
});
