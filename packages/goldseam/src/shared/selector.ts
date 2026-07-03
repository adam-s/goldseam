// Derive the broken selector from Cypress error text. Best-effort: a hit
// sharpens prompts and (later) keys the heal cache; a miss costs nothing.

const SELECTOR_PATTERNS = [
  // "Expected to find element: `[data-cy=pay]`, but never found it."
  /Expected to find element: `([^`]+)`/,
  // "…because this element is detached from the DOM: `<button …>`" carries
  // markup, not a selector — deliberately not matched.
];

export function extractFailedSelector(errorMessage: string): string | undefined {
  for (const pattern of SELECTOR_PATTERNS) {
    const match = errorMessage.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}
