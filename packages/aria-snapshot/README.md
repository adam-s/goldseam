# aria-snapshot

Playwright's `ariaSnapshot` — the accessibility-tree walk and YAML
renderer — as a standalone, pure-DOM package. Runs in any page context:
no CDP, no Playwright runtime, no browser automation required.

```ts
import { ariaSnapshot } from 'aria-snapshot';

const yaml = ariaSnapshot(document.body);
// - banner:
//   - heading "goldseam demo shop" [level=1]
// - button "Add to cart"
```

The full API — `generateAriaTree` / `renderAriaTree` for the tree object,
`matchesAriaTree` / `getAllByAria` for matching elements against an aria
template — is exported alongside the one-call convenience. The output is
Playwright's aria-snapshot YAML format, so anything that consumes
`toMatchAriaSnapshot` fixtures can consume this. Built for
[goldseam](https://github.com/adam-s/goldseam) (self-healing for Cypress
suites), where the accessibility tree rides along with every failure
capture — but it has no goldseam dependency and works anywhere a DOM
exists (browser, jsdom).

## Targeting

The tree is an addressing space, not just evidence: a node like
`button "Add to cart"` names an element, and the package resolves names
in both directions.

```ts
import { getAllByAria, deriveSelector } from 'aria-snapshot';

// identity → element
const [btn] = getAllByAria(document.body, {
  kind: 'role', role: 'button', name: 'Add to cart',
});

// element → best unique native selector, priority-ordered and
// uniqueness-verified ({ kind, selector, text?, strategy })
deriveSelector(btn, { priority: ['data-cy', 'data-testid', 'id', 'text', 'css'] });
```

A tool (or a model) points at *what* to target semantically; code decides
*how* to target it.

## Iframes and serialized captures

- `ariaSnapshot(root, { frames: true })` descends **same-origin** iframes
  (live DOM); their content nests under the `iframe` node. Cross-origin
  frames stay opaque leaves.
- Serialized DOM (a capture re-parsed for analysis) is traversed too:
  declarative shadow templates (`<template shadowrootmode>`) and the
  `<template data-frame-content>` convention for inlined iframe documents.
  `queryAllDeep` runs boundary-respecting CSS queries over such captures;
  `expandSerializedTemplates` rewrites them as plain wrappers when you
  need ordinary queries and real computed styles.

## License

Apache-2.0. This package is a lift of Playwright's isomorphic
aria-snapshot code; attribution and provenance are in
[NOTICE](NOTICE).
