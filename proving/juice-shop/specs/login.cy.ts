// Juice Shop's own selector culture: bare ids (#email, #password,
// #loginButton) — lifted from its first-party Cypress suite.
describe('login', () => {
  it('rejects a wrong password with an error', () => {
    cy.visit('/#/login');
    cy.get('#email').type('admin@juice-sh.op');
    cy.get('#password').type('definitely-wrong');
    cy.get('#loginButton').click();
    cy.get('.error').should('contain', 'Invalid email or password');
  });

  it('logs in the demo admin', () => {
    cy.visit('/#/login');
    cy.get('#email').type('admin@juice-sh.op');
    cy.get('#password').type('admin123');
    cy.get('#loginButton').click();
    cy.get('#navbarAccount').click();
    cy.get('button[aria-label="Go to user profile"]').should('contain', 'admin@juice-sh.op');
  });
});
