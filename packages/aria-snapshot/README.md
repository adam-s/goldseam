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

## License

Apache-2.0. This package is a lift of Playwright's isomorphic
aria-snapshot code; attribution and provenance are in
[NOTICE](NOTICE).
