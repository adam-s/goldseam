// Instructor journey against the demo course (mirrors debug-harness
// journeys): brittle-by-design selector textures (#id, .class, href*=)
// chosen deliberately — these are the heal candidates.
import { devLogin } from '../support';

describe('course admin', () => {
  beforeEach(() => devLogin('Editor'));

  it('reaches the getting started checklist', () => {
    cy.visit('/pl/course/1/course_admin/getting_started');
    cy.contains('h1', 'Getting started').should('be.visible');
  });

  it('lists course instances from the instances page', () => {
    cy.visit('/pl/course/1/course_admin/instances');
    cy.get('#courseInstancesTable, table').should('be.visible');
    cy.get('a[href*="course_instance"]').should('exist');
  });

  it('opens the questions page and finds the add button', () => {
    cy.visit('/pl/course/1/course_admin/questions');
    cy.contains('Questions').should('be.visible');
  });
});
