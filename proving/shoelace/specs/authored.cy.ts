// Plain-English authoring against web components: the interesting
// question is whether English can drive SHADOW-DOM interactions (the
// config sets includeShadowDom, so translated cy.get selectors pierce).
describe('authored', () => {
  it('expands a details component, in plain English', () => {
    cy.visit('/components/details/');
    cy.goldseam([
      'Force click the header of the first details example',
      'The first sl-details element should have the open attribute',
    ]);
  });
});
