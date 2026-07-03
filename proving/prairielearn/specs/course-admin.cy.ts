// Instructor journey against the bundled example course on a real
// PrairieLearn instance (~500k-LoC production app, Bootstrap UI). The
// selector textures below are deliberately mixed — data-testid, hrefs,
// headings — exactly the break-and-heal candidates a real suite carries.
import { devLogin } from '../support';

describe('course admin', () => {
  beforeEach(devLogin);

  it('opens the questions page', () => {
    cy.visit('/pl/course/1/course_admin/questions');
    cy.get('[data-testid="table-scroll-container"]').should('be.visible');
  });

  it('reaches course settings', () => {
    cy.visit('/pl/course/1/course_admin/settings');
    cy.contains('h1', 'course settings').should('be.visible');
  });

  it('lists course instances', () => {
    cy.visit('/pl/course/1/course_admin/instances');
    cy.get('a[href*="course_instance"]').should('exist');
  });
});
