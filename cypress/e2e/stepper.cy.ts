// Usage-catalog cluster: repeat actions (item 10) — "click the + button 3
// times", floor behavior, and the quantity flowing through to the cart.
describe('quantity stepper', () => {
  beforeEach(() => cy.visit('/product.html?id=5'));

  it('increments three times and adds that quantity to the cart', () => {
    cy.get('[data-testid="qty-increment"]').click().click().click();
    cy.get('#qty-value').should('have.text', '4');
    cy.get('#add-single').click();
    cy.get('#cart-count').should('have.text', '4');
  });

  it('never goes below one', () => {
    cy.get('.qty-decrement').click().click();
    cy.get('#qty-value').should('have.text', '1');
  });
});
