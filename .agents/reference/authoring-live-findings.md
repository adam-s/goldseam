# Authoring on live sites — what the evidence says (2026-07)

A live-site campaign against `cy.goldseam` authoring: real models
(Claude Opus/Sonnet via the Code CLI; self-hosted Qwen2.5-14B on Modal;
Qwen2.5-VL-7B for vision) driving real pages, captured headless with
patchright (stealth Chromium), graded two ways — the produced selector
must resolve on the live page, and the assembled commands must pass as a
real Cypress run. Method + harnesses were throwaway (scratch); this file
is the durable conclusion.

## What holds

- **Translation grounds and RUNS.** Across ~50 live situations, Opus
  produced **zero wrong selectors** and its grounded translations, rendered
  through goldseam's own `eject` and executed as real Cypress specs, passed
  **8/8** on live sites (the-internet, saucedemo). Sonnet matched it
  (21/24 grounded, 4/4 correct refusals). The pipeline — English → translate
  → eject → Cypress → green — works end to end.
- **Multi-page workflows work with per-step grounding.** A single up-front
  DOM snapshot cannot ground later-page steps (checkout button on a page you
  haven't reached). Re-capturing the DOM before each step and translating it
  there closes the gap: a 6-step the-internet auth journey (login → assert →
  logout → assert) authored and ran green per-step.
- **Honesty holds under a strong model.** Opus/Sonnet refuse vague or
  ambiguous steps (6/6 correct refusals in one set) rather than guess.

## Where it breaks (real gaps, ranked)

1. **Large pages: the head-first DOM cut.** On page-builder/docs/Wikipedia
   pages the target sits past the prompt budget; **Opus and Sonnet both
   refuse** ("Pricing"/"Talk"/search) because the 40K head slice can't reach
   it. FIXED by the step-anchored authoring window + configurable `domBudget`
   (PR: `plugin/translate-window.ts`) — a 14B model with a 16K window grounded
   a page both frontier models refused.
2. **Dynamic / AJAX content timing.** SPA/AJAX pages load the target *after*
   `domcontentloaded`; the captured DOM misses it. The fix is a
   capture-**settle**, and the placement is load-bearing (proven by driving
   5 hard multi-page workflows to 3/5 fully-live + 4/4 assembled Cypress specs
   green, incl. a full 12-step SauceDemo checkout):
   - a **post-action** settle (a click returns *before* its navigation begins,
     so a pre-capture settle alone still grounds the next step on the OLD page
     — this was the SauceDemo cart→checkout stall);
   - `networkidle` **plus** a DOM-stability poll (client `setTimeout` content
     fires no request, so `networkidle` never triggers — the-internet
     "Hello World!");
   - retry-able assertions (mirroring Cypress's own assertion retry) for
     late-appearing asserted text.
   A plugin/harness concern, not selector quality. *Deferred: settle strategy
   for `cy.goldseam` capture.*
3. **Small models under-refuse.** Self-hosted Qwen2.5-14B hallucinated
   selectors for 4/6 ambiguous steps where Opus refused. The refusal contract
   **cannot** be delegated to a weak translator — goldseam's offline
   resolve/oracle ambiguity rungs must stay the backstop.
4. **Selectors resolve but aren't always optimal.** Grounded ≠ stable: models
   emit `:nth-of-type` (all sizes), `[onclick=…]`, class hooks. Brittleness
   rises as the model shrinks (Opus 14% brittle → 14B 30%).

## The two levers, measured

- **Bigger context is worse, not better.** Feeding a 32K-context 14B the full
  ~100K-char DOM grounded no more large pages than the 40K slice *and
  hard-failed (HTTP 400 overflow)* on the biggest. The **small anchored
  window wins**: grounds more, never overflows, 3–8× cheaper. `domBudget` is a
  hard ceiling, not a target.
- **Vision (Set-of-Mark) is a narrow niche, not a default.** Research
  (SeeAct: text grounding beats SoM ~3:1 on web; hallucinated marks on dense
  pages) and our runs agree: SoM grounded 3/3 large pages text *refused*, but
  a screenshot can't emit a CSS selector, it *can't refuse* (forced-choice
  picked a box for vague steps), and the small VLM fabricated out-of-range
  marks. Critically, once interactive elements are **enumerated with
  pre-derived unique selectors** and handed to the *text* model, text alone
  recovered 3/4 of those "vision-only" cases. Vision earns a place only for
  visually-distinct-but-textually-identical elements.

## Phase-2 roadmap (evidence-backed, not yet built)

Ranked by measured value:

1. **ARIA-outline as the translation representation.** Sending the
   accessibility outline (each interactive node carrying a `deriveSelector`
   locator) instead of raw DOM grounded **8/9 vs 6/9 at fewer tokens** and
   *structurally* dissolves the large-page cut (the whole interactive surface
   fits in a fraction of the budget) while improving selector optimality
   (pre-verified-unique locators). Bigger change to the prompt contract than
   the window; likely supersedes it. Risk: closed-shadow/portal residue needs
   a raw-DOM fallback; `expandSerializedTemplates` for open shadow.
2. **Deterministic post-translation verify + re-derive.** After the model
   proposes, verify the selector resolves; if not (or if brittle), re-derive
   from the intended element via `deriveSelector`. Fixed 2/3 genuinely-broken
   14B selectors and upgraded a brittle one to an `#id` — zero model cost.
   Reframes the model's job as "point at the right element," making cheap
   self-hosted models viable. Belongs in the authoring path (needs step
   intent); must defer to give-up when the element can't be located.
3. **Selector-optimality `reviewFlag`.** A cordyceps-style cost model
   (`kTestIdScore…kNthScore`) + guid/framework-auto-id + volatile-`data-*`
   filters, flagging (never blocking) brittle authored/healed selectors —
   the authoring analog of the weak-assertion flag.
4. **Capture-settle for dynamic pages** (gap #2 above).
5. **Postcondition → assertion prompt rule.** Teach the translator to emit a
   verifying `assert` after a state-changing action (a panel opens, a row
   disappears) — closes authoring's action-only false-green at the source.
   (Harvesting recorded journeys' `done{}` postconditions was a dead end —
   the field is schema-supported but unpopulated in practice.)
6. **`goldseam import <journey.json>`.** A recorded browser journey
   (goto/click/type/done) compiles 1:1 to `StepCommand`s with zero model
   calls; demonstrated compiling + passing a live Cypress run. Real
   selectors + `done{}` postconditions would ground translation better than a
   DOM snapshot alone.

## Known follow-ups — both now RESOLVED

- **`heal/dom-window.ts` `emitWindow` scaffold-overflow — already fixed.** The
  final `slice(0, budget)` clamp was added by the "window bound" trust-hardening
  pass; a deep attribute-heavy scaffold can no longer push the emitted region
  past the budget. (The exp1 note that flagged this predated that merge.)
- **`heal/parse.ts` `parseJsonBlock` trailing-prose — fixed.** It stripped a
  code fence then `JSON.parse`d the WHOLE reply, so `{"commands":[…]}\n\nWait —
  let me double-check…` (Opus intermittently appends self-doubt after a complete
  object) failed outright — a parse error on real-model heal AND authoring, not
  a capability miss. Now: on a failed direct parse it falls back to the first
  balanced `{…}` object (brace-depth scan respecting strings/escapes), handling
  prose on either side; the strict path still rejects a reply with no parseable
  object. Pinned in heal-validate.test.ts.
