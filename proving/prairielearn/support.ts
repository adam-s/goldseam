import 'goldseam/support/register';

// PL dev-mode auth (ported from the debug harness's journey helpers):
// GET /pl/dev_login authenticates the dev admin; the course-role cookie
// emulates lower roles when needed.
export function devLogin(role: 'Editor' | 'None' = 'Editor'): void {
  cy.request('/pl/dev_login');
  cy.setCookie('pl2_requested_course_role', role);
}
