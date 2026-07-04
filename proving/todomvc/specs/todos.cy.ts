// Hand-written suite in TodoMVC's native selector culture: semantic
// classes, zero test hooks — the hardest common case for healing
// (nothing stable to fall back on except structure and text).

describe('todos', () => {
  beforeEach(() => {
    cy.visit('/');
    cy.get('.new-todo').type('buy milk{enter}');
    cy.get('.new-todo').type('walk the dog{enter}');
  });

  it('adds todos and counts them', () => {
    cy.get('.todo-list li').should('have.length', 2);
    cy.get('.todo-count').should('contain', '2 items left');
  });

  it('completes a todo', () => {
    // order-agnostic: this variant renders newest-first
    cy.contains('.todo-list li', 'buy milk').find('.toggle').check();
    cy.get('.todo-list li.completed').should('have.length', 1);
    cy.get('.todo-count').should('contain', '1 item left');
  });

  it('clears completed todos', () => {
    cy.contains('.todo-list li', 'buy milk').find('.toggle').check();
    cy.get('.clear-completed').click();
    cy.get('.todo-list li').should('have.length', 1);
    cy.get('.todo-list li').first().should('contain', 'walk the dog');
  });

  it('filters active todos', () => {
    cy.contains('.todo-list li', 'buy milk').find('.toggle').check();
    cy.contains('.filters a', 'Active').click();
    cy.get('.todo-list li').should('have.length', 1);
    cy.get('.todo-list li').should('contain', 'walk the dog');
  });
});
