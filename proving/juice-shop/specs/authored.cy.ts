// Plain-English authoring against Angular Material. cy.visit runs FIRST
// so the translator sees the real login page DOM (redacted) instead of
// guessing from a blank page.
describe('authored', () => {
  it('rejects bad credentials, in plain English', () => {
    cy.visit('/#/login');
    cy.goldseam([
      "Type 'admin@juice-sh.op' into the email field",
      "Type 'not-the-password' into the password field",
      'Click the log in button',
      "An error should appear saying 'Invalid email or password'",
    ]);
  });
});
