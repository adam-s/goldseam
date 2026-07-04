import 'goldseam/support/register';

// Juice Shop's welcome banner + cookie bar overlay the page; its own
// suite pre-dismisses both via cookies (test/cypress/support/setup.ts).
beforeEach(() => {
  cy.setCookie('welcomebanner_status', 'dismiss');
  cy.setCookie('cookieconsent_status', 'dismiss');
});
