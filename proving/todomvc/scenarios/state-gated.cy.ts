// Scenario (not in specPattern — copy into specs/ to run): the input is
// hidden for 3s by the drifted app; the selector was never wrong.
// Correct verdict: triage gives up with state-gated evidence, zero model
// calls. Proves the cypress#7306-class row of issue-proofs.md.
describe('state-gated', () => {
  it('types into the visible input', () => {
    cy.visit('/');
    cy.get('.new-todo:visible', { timeout: 800 }).type('x{enter}');
  });
});
