# Hazard catalog — what bites selector tools, with runnable examples

The intercept2 move (fake sites, one per pattern family) applied to
goldseam: every DOM/interaction hazard that bites healing or authoring
gets ONE row and ONE canonical example. Examples live in three tiers —
`demo/hazards.html` (live Cypress), `bench/translate-cases/` (authoring
eval), unit fixtures (rung tests) — and a row may only claim "handled"
by naming one. Companions: [disambiguation.md](disambiguation.md) (the
verdict per judgment call), [issue-proofs.md](issue-proofs.md) (the
demand evidence).

| Hazard | Why it bites | Example | Behavior |
| --- | --- | --- | --- |
| Same-origin iframe | invisible to outerHTML; bare cy.get never reaches inside | `demo/hazards.html` #frame-widget; capture-frames unit pins | captured as `<template data-frame-content>`; triage names frame-scoping, not timing |
| Cross-origin iframe | unreachable, period | — (wall) | opaque leaf; documented wall |
| Open shadow DOM | outerHTML drops it; combinators can't cross | hazards page DSD card; Shoelace proving; `shadow-dsd` eval case | serialized as DSD; heal + authoring `shadow` field |
| Closed shadow root | unreachable by design | — (wall) | documented wall |
| Portal/teleported UI | tooltip/menu renders at body end, far from its trigger | hazards page #portal-tip | capture carries both sites; text asserts find it |
| Identical siblings | "the Save button" ×2 — any guess is a coin flip | `refuse-two-saves` eval case; checkbox live probe | authoring refuses; resolve rejects ambiguous heals |
| Delayed render | content arrives after the retry window | hazards page #slow-panel | triage: timing give-up, zero model calls |
| Present-but-hidden | selector was never wrong; state gates it | TodoMVC `:visible` probe (CAMPAIGN.md) | triage: state-gated give-up |
| Overlay-covered | banners/modals eat clicks | Juice Shop cookie banner; `force-click-overlay` eval case | precondition step or explicit "force click" |
| Virtualized list | off-screen rows don't EXIST in the DOM | `refuse-virtualized` eval case | authoring refuses ("item not in DOM"); heal can't target absence |
| Dynamic/random ids | `#input-8f3a` changes every load | `dynamic-ids` eval case | prefer stable attrs; selectorPriority is the contract |
| Split/pieced text | "Add<span>to</span>cart" defeats naive contains | hazards page #split-text | textContent-based matching tolerates it; exact-match asserts don't |
| Duplicated test ids | copy-pasted `data-testid` breaks uniqueness | `deriveSelector` fall-through unit pin | uniqueness verified; falls to next strategy |
| Canvas UI | no DOM to capture or heal | — (wall) | documented wall (shared with cy.prompt) |
| Head/style bloat | a real `<head>` alone can eat the model's DOM budget | Wikipedia live probe; `translationDom` unit pin | body-budget stripping; refusal if still blind |
| Comment mentions of selectors | spec comments are model-visible and defeat substring checks | Juice Shop proving (sibling probe bug) | string-literal-aware checks; keep proofs hint-free |

Rules: new hazard → new row BEFORE code; a row without a named example
is a work item, not a claim; walls are rows too — honest limits beat
silent gaps.
