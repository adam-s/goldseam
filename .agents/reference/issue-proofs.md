# Issue proofs — real demand, reproducible answers

Mined from the incumbents' and Cypress's own issue queues (2026-07-03
sweep in [competition.md](competition.md); refreshed 2026-07-04 for the
proving campaign). Each row is a real, linkable pain → the goldseam
behavior that answers it → the executable proof. Rows without a proof
date are the campaign's work queue — "handled" claims require a green
proof, not an argument.

| Issue (reactions) | Pain | goldseam answer | Proof |
| --- | --- | --- | --- |
| healenium#56, #76 | tree-similarity heals the WRONG element ("next element of the same type") and keeps interacting with it | oracle rung: healed selector must land on the known-good aria identity; impostors rejected offline | heal E2E oracle-teeth ✓ 2026-07-04; unit pins (positional, cross-boundary) |
| healenium#88 | invisible/absent elements "healed" | resolve rung: zero matches in the captured DOM rejects before any rerun; give-up is first-class | heal E2E hallucination-offline ✓; Juice Shop hint-free give-up ✓ 2026-07-04 |
| healenium#81 | shadow-root elements unreachable by the healer | capture serializes open shadow roots; resolve/oracle/aria walk descend them; heals target shadow content | unit pins ✓; **planned: Shoelace leg (real web-components app)** |
| healenium#75 | verdict/telemetry lies ("healing occurs despite not-successful mark") | verdicts are artifacts; every rung's verdict recorded; CLI prints the same ladder the artifact carries | heal E2E ladder-shape checks ✓ |
| codeceptjs#4527 | heal doesn't persist — re-heals the same break every scenario/run | heals are commits (permanent by construction); heal memory serves repeats with zero model calls | heal E2E cache leg ✓; **planned: cross-spec cache reuse on a proving app** |
| codeceptjs#4526 | healing breaks in parallel mode | artifact files keyed by test identity, atomic writes, no server state | artifacts unit pins ✓; **planned: two simultaneous breaks in one spec (knownBrokenTitles path) on a proving app** |
| codeceptjs#4347, #4394 | healer priorities not respected | `selectorPriority` honored in prompts; deriveSelector walks it mechanically | deriveSelector priority pins ✓; PrairieLearn heal chose role-selector per priority ✓ |
| cypress#136 (+1046), #1433, #32800 | iframes: can't reach them, can't snapshot them, cy.prompt won't touch them | capture inlines same-origin frame documents (redacted), aria nests them, triage names frame-scoping honestly | unit pins ✓ 2026-07-04; **planned: real embedded-iframe scenario on a proving app** |
| cypress#7306 (+541), #5743, #23305 | "element detached from the DOM" flake — red that isn't selector drift | triage rung: a "missing" selector still present in the capture ⇒ timing/state give-up, zero model calls, honest evidence | unit pins ✓; **planned: real timing-flake give-up on a proving app** |
| cypress#8843 (+25), #30438 | DOM snapshots don't include shadow DOM | `redactedOuterHtml` serializes open shadow roots as declarative templates | capture unit + system pins ✓; Shoelace leg will prove at app scale |
| cypress#20458 (closed "use cy.prompt"), #30805 | heal EXISTING suites — demand Cypress redirected to a rewrite | the whole product: unmodified `cy.get` suites healed as reviewed commits | PrairieLearn ✓ 2026-07-03; TodoMVC ✓; Juice Shop (Angular Material) ✓ 2026-07-04 |
| cypress#32673, #33927 | BYO model / air-gapped — cy.prompt phones home | RepairRunner: `claude`, `cmd:` today; HTTP/ollama planned (M5) | stub-driven E2E ✓; ollama leg is M5 |
| cypress#32791 | prompt-authored steps: query without action | `cy.goldseam` constrained vocabulary includes assert-only steps | prompt E2E ✓; **planned: authoring legs on proving apps** |

Rules for this file: a row may only claim ✓ with a named, runnable proof
(test or proving-ground result). New mined issues get a row BEFORE any
code is written to answer them.
