// Dogfood over the hazard gallery (demo/hazards.html) — each test is a
// hazard-catalog row's live example, CI-safe and green.
describe('hazard gallery', () => {
  beforeEach(() => cy.visit('/hazards.html'));

  it('portal tooltip: teleported content is reachable by text', () => {
    cy.get('#tip-trigger').trigger('mouseenter');
    cy.contains('#portal-tip', 'Teleported').should('exist');
  });

  it('split text: textContent matching tolerates pieced words', () => {
    cy.contains('button', 'Add to cart').should('have.id', 'split-text');
  });

  it('shadow DSD: content behind the boundary', () => {
    cy.get('hazard-card').shadow().find('.card-buy').should('exist');
  });

  it('same-origin frame: content exists behind the frame wall', () => {
    cy.get('#pay-frame').its('0.contentDocument.body').find('#frame-pay').should('exist');
  });

  it('dynamic ids: the stable hooks survive reloads', () => {
    cy.get('[data-field="coupon"]').invoke('attr', 'id').then((first) => {
      cy.reload();
      cy.get('[data-field="coupon"]').invoke('attr', 'id').should('not.eq', first);
    });
  });
});
