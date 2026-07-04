// Canonical Cypress shadow-DOM culture: .shadow().find() to cross into a
// component's shadow root. Existence (not visibility) assertions —
// Cypress's visibility engine misjudges fixed-position elements inside
// shadow roots (cypress#33046), which we hit live on this page.
describe('shoelace docs', () => {
  it('opens and closes the dialog demo', () => {
    cy.visit('/components/dialog/');
    cy.contains('sl-button', 'Open Dialog').first().scrollIntoView().click({ force: true });
    cy.get('sl-dialog.dialog-overview[open]').shadow().find('.dialog__panel').should('exist');
    cy.get('sl-dialog.dialog-overview[open]')
      .shadow()
      .find('[part="close-button"]')
      .click({ force: true });
    cy.get('sl-dialog.dialog-overview[open]').should('not.exist');
  });

  it('expands a details panel via its shadow header', () => {
    cy.visit('/components/details/');
    cy.get('sl-details').first().shadow().find('[part="header"]').click({ force: true });
    cy.get('sl-details').first().should('have.attr', 'open');
  });
});
