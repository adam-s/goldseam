// Usage-catalog cluster: labeled forms with enabled/disabled states
// (items 2, 15, 20) — attribute assertions and state preconditions.
describe('checkout form', () => {
  beforeEach(() => cy.visit('/checkout.html'));

  it('keeps the submit disabled until every field is valid', () => {
    cy.get('[data-testid="place-order"]').should('be.disabled');
    cy.get('#full-name').type('Ada Lovelace');
    cy.get('#email').type('ada@example.com');
    cy.get('[data-testid="place-order"]').should('be.disabled');
    cy.get('#address').type('12 Analytical Way');
    cy.get('[data-testid="place-order"]').should('be.enabled');
  });

  it('has a submit-typed order button', () => {
    cy.get('[data-testid="place-order"]').should('have.attr', 'type', 'submit');
  });

  it('places the order and shows the confirmation', () => {
    cy.get('#full-name').type('Ada Lovelace');
    cy.get('#email').type('ada@example.com');
    cy.get('#address').type('12 Analytical Way');
    cy.get('[data-testid="place-order"]').click();
    cy.get('#checkout-form').should('not.be.visible');
    cy.get('#order-confirmation').should('be.visible');
    cy.get('#order-number').invoke('text').should('match', /^DS-/);
  });
});
