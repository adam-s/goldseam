// Usage-catalog cluster: hover-revealed content (items 12, 17) — inline and
// portal-rendered tooltips, text + visibility asserted together.
describe('tooltips', () => {
  beforeEach(() => cy.visit('/'));

  it('shows and hides the inline tooltip on hover', () => {
    cy.get('.tooltip').should('not.exist');
    cy.contains('button', 'Returns policy').trigger('mouseenter');
    cy.get('.tooltip').should('be.visible').and('contain', 'Free returns within 30 days');
    cy.contains('button', 'Returns policy').trigger('mouseleave');
    cy.get('.tooltip').should('not.exist');
  });

  it('shows the portal-rendered tooltip (not a descendant of its trigger)', () => {
    cy.get('#shipping-info').trigger('mouseenter');
    cy.get('.portal-tooltip')
      .should('be.visible')
      .and('contain', 'Ships in 2–4 business days')
      .parent()
      .should('match', 'body');
    cy.get('#shipping-info').trigger('mouseleave');
    cy.get('.portal-tooltip').should('not.exist');
  });
});
