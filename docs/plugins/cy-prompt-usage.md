# cy.prompt in the wild — usage catalog from the issue queue

Every distinct way people use (or try to use) `cy.prompt`, extracted
2026-07-03 from all 24 cy.prompt-related issues in `cypress-io/cypress`
(bodies + full comment threads). This is the test surface goldseam's
demo shop and benchmark must cover to claim parity honestly.

Companion to [cy-prompt-anatomy.md](cy-prompt-anatomy.md) (how it works);
this file is *what users do with it*.

## A. Authoring shapes (how the command appears in real specs)

1. **Multi-step journey arrays** — the canonical form: visit → type into
   labeled field → click by description ("Visit… / Type Paris in 'where do
   you want to go' / Click on the first result / Press the Create Itinerary
   Button") — [#31826](https://github.com/cypress-io/cypress/issues/31826)
2. **Full login-to-workflow flows** with credentials via `placeholders`
   (`'Enter {{password}} in password field'`,
   `{ placeholders: { password: … } }`) —
   [#33063](https://github.com/cypress-io/cypress/issues/33063)
3. **Chaining off the yield** — `.then((responses) => …)` after the prompt
   ([#33063](https://github.com/cypress-io/cypress/issues/33063));
   requested `cy.prompt('Get the "Checkout" button').click()` form
4. **Page-object retrofit** — replacing element getters in existing page
   objects with prompts, "to add self-healing to flaky things without
   reworking anything else" —
   [#32791](https://github.com/cypress-io/cypress/issues/32791)
5. **Gherkin/BDD step-per-prompt** — Given/When/Then lines as prompts; a
   formal `cy.gherkin.prompt` proposal from a Cucumber shop with
   PageObject.ts / Selector.ts / Steps.ts structure —
   [#33084](https://github.com/cypress-io/cypress/issues/33084)
6. **Whole-suite ambition** — "99% cy.prompt commands, with the remaining
   1% custom commands for database or API access" —
   [#33273](https://github.com/cypress-io/cypress/issues/33273)
7. **Mixed suites** — prompts alongside `cy.viewport()`/`cy.visit()`/custom
   commands; data-driven `forEach` loops; inside `cy.origin()` (docs/blog)
8. **Eject-to-code workflow** — generate once, commit, run without AI
   (official docs; healing is forfeited on eject)

## B. Interaction vocabulary (what the steps ask for)

9.  Click by **visible text/label** and by **position** ("first result") —
    [#31826](https://github.com/cypress-io/cypress/issues/31826)
10. **Repeat actions** — "Click the '+' button 3 times" —
    [#32851](https://github.com/cypress-io/cypress/issues/32851)
11. **Multi-element actions** — "Click all checkboxes in filters" —
    [#32850](https://github.com/cypress-io/cypress/issues/32850)
12. **Hover/mouseenter/mouseleave for tooltips** — PrimeNG, AG-Grid,
    Material, incl. shadow-DOM/portal-rendered tooltips; expected
    `cy.get('#warning').trigger('mouseenter', { force: true })` —
    [#33042](https://github.com/cypress-io/cypress/issues/33042),
    [#32794](https://github.com/cypress-io/cypress/issues/32794)
13. **Trigger arbitrary DOM events** — drag, mouseup, mousedown —
    [#32794](https://github.com/cypress-io/cypress/issues/32794) comments
14. **Scrolling** — window ("scroll to the bottom of the page") and
    element-scoped ("scroll to the end in the infinite scroll container"),
    plus scrollIntoView —
    [#32789](https://github.com/cypress-io/cypress/issues/32789)
15. **Form state preconditions** — "Ensure that Username and Password field
    is enabled" — [#33063](https://github.com/cypress-io/cypress/issues/33063)
16. **Per-step timeout/force modifiers in natural language** ("with a
    timeout of 10 seconds", "force click") — official docs

## C. Assertion vocabulary

17. **Text + visibility combined** — "verify the tooltip appears with
    'This is a helpful tooltip!'" → `contains` + `be.visible` —
    [#32788](https://github.com/cypress-io/cypress/issues/32788)
18. **Collection length** — "The products list should have 3 products" →
    `.children('li').should('have.length', 3)` with list/table/role-aware
    child resolution —
    [#32787](https://github.com/cypress-io/cypress/issues/32787)
19. **Element order** — "The first product should be 'Backpack'" →
    `.first()/.eq()/:nth-child` semantics; naive per-element selectors
    betray test intent —
    [#32831](https://github.com/cypress-io/cypress/issues/32831)
20. **Attribute/CSS/data/prop assertions** — "The button should have
    attribute 'type' with value of 'submit'" —
    [#32790](https://github.com/cypress-io/cypress/issues/32790)
21. **not.exist** — by CSS selector and by pure natural language, with two
    temporal flavors: existed-then-removed (modal close) vs never-existed —
    [#32793](https://github.com/cypress-io/cypress/issues/32793),
    [#33274](https://github.com/cypress-io/cypress/issues/33274)
22. **Query-without-action** — yield an element, no interaction —
    [#32791](https://github.com/cypress-io/cypress/issues/32791)
23. **Response-body assertions** — "Expect response of the intercepted
    login request to contain a token field which should not be null or
    empty" — [#33063](https://github.com/cypress-io/cypress/issues/33063)

## D. App/network control (requested; cy.prompt refuses today)

24. **Intercept + wait** on requests triggered by clicks —
    [#33063](https://github.com/cypress-io/cypress/issues/33063)
25. **API testing** — "Verify that '/api/test' was called"; REST requests —
    [#32792](https://github.com/cypress-io/cypress/issues/32792)
26. **Clear session/cookies** mid-prompt —
    [#32810](https://github.com/cypress-io/cypress/issues/32810)

## E. Environments people run it in (and where it breaks)

27. **Same-origin iframes**
    ([#32800](https://github.com/cypress-io/cypress/issues/32800));
    **canvas** ([#32830](https://github.com/cypress-io/cypress/issues/32830));
    **shadow DOM/portals**
    ([#33042](https://github.com/cypress-io/cypress/issues/33042))
28. **Air-gapped/offline** — 15.13+ phones `api.cypress.io/cy-prompt/session`
    even when cy.prompt isn't invoked; user-submitted `CYPRESS_DISABLE_AI`
    PR; team "evaluating options" —
    [#33927](https://github.com/cypress-io/cypress/issues/33927)
29. **Corporate proxy/firewall** — Zscaler/firewall users locked out of all
    Cloud-bound features —
    [#32672](https://github.com/cypress-io/cypress/issues/32672) comments
30. **Parallel CI containers** — cache-consistency anxiety; cache confirmed
    to live **in Cypress Cloud**, no file-based representation; adding one
    step invalidates the whole prompt's cache —
    [#33273](https://github.com/cypress-io/cypress/issues/33273)
31. **BYO model demand** — own API keys, "custom openai-compatible endpoints
    with a different BASE_URL, MODEL_ID and API_KEY" for security-restricted
    environments — [#32673](https://github.com/cypress-io/cypress/issues/32673).
    This is goldseam's RepairRunner as a feature request sitting open in
    their queue.

## F. Selector culture (from the Selector Playground revolt, #32672)

Directly feeds the benchmark's selector-style axis:

32. Teams **without data-cy/testid standards** hand-crafting
    `button:contains(Continue):visible`-style selectors, centralized in
    Selector.ts files
33. Auto-generated **long descendant CSS** (`#app .svx-modal-header`) from
    recording tools
34. Testing **sites they don't control** ("I have to get creative with
    selectors")
35. Demand history:
    [#20458](https://github.com/cypress-io/cypress/issues/20458)
    ("Implement self healing mechanism", 2022, for existing scripts)
    accumulated years of "any update?" before being closed with *"this is
    addressed via cy.prompt"* — Cypress's official answer to healing
    existing suites is "rewrite them as prompts."

## What this means for the demo shop and benchmark

**Demo shop must contain the widgets these scenarios exercise**, so
mutation branches can break selectors inside each scenario type:

| Usage cluster | Demo-shop widget | Catalog items |
| --- | --- | --- |
| Hover-revealed content | Tooltip (incl. one portal-rendered) | 12, 17 |
| Appear/disappear | Modal with open/close (`not.exist`, both temporal flavors) | 21 |
| Collections | Filterable product list (count, order, first/last) | 18, 19, 11 |
| Forms | Labeled login/checkout form, enabled/disabled states | 2, 15, 20 |
| Scroll | Overflow container / long page | 14 |
| Network-backed | XHR-driven action (add-to-cart) | 23–25 |
| Repeat/multi | Quantity stepper, checkbox group | 10, 11 |

**Benchmark selector-style axis** mirrors cluster F — the real-world
distribution: `data-cy` / `id` / role+text / `:contains()` chains /
brittle auto-generated descendant CSS. Heal-rate by selector style across
these is the launch table.

**Shared walls, documented honestly:** network control (D) and canvas —
cy.prompt gives up there too. Exception worth exploring: **same-origin
iframes** — our DOM capture could include iframe content where cy.prompt
doesn't; a cheap differentiator worth a benchmark cell.
