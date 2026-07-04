// Plain-English authoring against a real app: translated once by the
// configured model, cached as a committable file, replayed free forever.
describe('authored', () => {
  it('adds a todo in plain English', () => {
    cy.goldseam([
      'Go to the home page',
      "Type 'water the plants' into the new todo input and press enter",
      'The todo list should have exactly 1 item',
    ]);
  });
});
