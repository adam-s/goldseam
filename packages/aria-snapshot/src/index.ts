// Public API of @goldseam/aria-snapshot.
//
// This package is a lift of Playwright's injected-script aria snapshot
// implementation (via the cordyceps project): a pure-DOM accessibility-tree
// walk plus the YAML renderer behind Playwright's ariaSnapshot(). It runs
// synchronously in any page context against a live Element — no CDP session,
// no Playwright runtime, no async. See NOTICE for attribution.
//
// Typical use (e.g. inside a test-failure capture hook):
//
//   const yaml = ariaSnapshot(document.body);
//
// Caveats inherited from the walk: open shadow roots are included; closed
// shadow roots are not; iframes appear as opaque leaf nodes (`role: iframe`)
// and are not descended into.

export {
  generateAriaTree,
  renderAriaTree,
  matchesAriaTree,
  getAllByAria,
  type AriaNode,
  type AriaSnapshot,
  type MatcherReceived,
} from './ariaSnapshot';

export type {
  AriaRole,
  AriaProps,
  AriaTemplateNode,
} from './isomorphic/ariaSnapshot';

import { generateAriaTree, renderAriaTree } from './ariaSnapshot';

/** One-call convenience: element → rendered YAML accessibility tree. */
export function ariaSnapshot(root: Element): string {
  return renderAriaTree(generateAriaTree(root));
}
