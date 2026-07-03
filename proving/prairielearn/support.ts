import 'goldseam/support/register';

// PL dev-mode setup (ported from the debug harness's journey helpers).
// dev_login authenticates the dev admin; loadFromDisk syncs the bundled
// example course so /pl/course/1/* is reachable on a fresh image.
export function devLogin(): void {
  cy.request({ url: '/pl/dev_login', followRedirect: true });
  cy.request({ url: '/pl/loadFromDisk', followRedirect: true });
}
