// Scenario (copy into specs/ to run): a plausible-sounding element that
// has never existed. Correct outcome: give-up — a healer that maps this
// onto some other button is manufacturing a false green (healenium#88).
describe('absent feature', () => {
  it('uses the biometric login', () => {
    cy.visit('/#/login');
    cy.get('#biometricLoginButton').click();
  });
});
