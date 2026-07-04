// CRWA's own selector culture: data-test everywhere.
describe('sign in', () => {
  it('validates the form before enabling submit', () => {
    cy.visit('/signin');
    cy.get('[data-test="signin-username"]').type('nobody');
    cy.get('[data-test="signin-password"]').type('abc'); // below the 4-char floor
    cy.get('[data-test="signin-submit"]').should('be.disabled');
    cy.get('[data-test="signin-password"]').type('definitely-long-enough');
    cy.get('[data-test="signin-submit"]').should('not.be.disabled');
  });

  it('rejects unknown credentials with an error', () => {
    cy.visit('/signin');
    cy.get('[data-test="signin-username"]').type('definitely-not-a-user');
    cy.get('[data-test="signin-password"]').type('wrong-password');
    cy.get('[data-test="signin-submit"]').click();
    cy.get('[data-test="signin-error"]').should('contain', 'Username or password is invalid');
  });
});
