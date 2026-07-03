// Usage-catalog cluster: shadow DOM / component libraries (item 27) —
// interaction inside an open shadow root, where outerHTML-based capture
// would otherwise be blind.
describe('shadow DOM widget', () => {
  it('interacts inside the open shadow root', () => {
    cy.visit('/');
    cy.get('support-badge').shadow().find('[data-testid="support-ping"]').click();
    cy.get('support-badge').shadow().contains('Ping received');
  });
});
