# Proving campaign — 2026-07-04 overnight run

Recursive iteration over real open-source apps (Adam's authorization:
"choose 4 more candidates and run the iterations"). Pattern per app:
clone to `/tmp/goldseam-proving/<app>`, boot locally, write specs in the
app's native selector culture, green baseline, induce realistic drift in
the /tmp copy, drive capture → heal (stub for mechanics, real Sonnet for
proving moments) and `cy.goldseam` authoring — every goldseam stumble
becomes a fix + pinned test + one conventional commit.

| App | Culture | Status |
| --- | --- | --- |
| PrairieLearn | Bootstrap prod monorepo, data-testid | done 2026-07-03 (2 real bugs) |
| TodoMVC (js-es6) | semantic classes, zero hooks | DONE: 2 real heals, give-up, authoring ✓; 5 bugs fixed |
| Juice Shop | Angular Material, id/class/aria soup | DONE: aria-label heal, honest give-up; 3 bugs fixed |
| Shoelace docs | web components, shadow DOM | DONE: shadow heal to [part] API; 185-shadow-root capture |
| Cypress RWA | React, data-test everywhere | DONE: 3-edit heal + sibling (0 calls) |

Boot notes:
- TodoMVC: `npx http-server /tmp/goldseam-proving/todomvc/examples/javascript-es6/dist -p 4180 -c-1`
- Juice Shop: `npm start` in the clone (port 3000, sqlite in-memory)
- Shoelace: `npm start` in the clone (docs dev server; note real port here)
- CRWA: `yarn dev` (UI 3000, API 3001) — boot AFTER Juice Shop is done (port clash)

Learnings land here as they happen; fixes land in the main packages with
pinned tests. Real-model calls: heals + translations only at proving
moments, never CI.

## Log

- 2026-07-04: campaign scaffolded; TodoMVC served, baseline suite written.
- 2026-07-04 TodoMVC leg 1: `.clear-completed→.purge-done` drift healed by
  Sonnet (0.97, one attempt) AFTER fixing two goldseam bugs it exposed:
  CLI must strip ELECTRON_RUN_AS_NODE (VS Code terminals break the rerun
  rungs), and infra failures must abort instead of re-proposing (3×
  identical model calls burned). Both pinned.
- 2026-07-04 TodoMVC leg 2 (hook drift): `.new-todo` drift broke beforeEach
  → Cypress aborts the whole describe, ONE capture titled `todos "before
  each" hook`. Exposed a correctness bug: rerunVerdictFor matched by test
  title, so hook heals could NEVER verify ("did not run" while all 4 gated
  tests passed). Fixed: hook-title verdicts judge the suite running past
  the hook; grep skipped for hook titles; identical-proposal dedup stops
  the retry burn (post-propose failures only — parse/validation keep the
  feedback budget); weak-assertion window widens to the whole suite for
  hook heals (the flag misfired on strongly-asserted gated tests). All
  pinned; Sonnet healed the 2-edit hook drift through the full ladder.
- 2026-07-04 TodoMVC leg 3: state-gated scenario (input hidden 3s,
  `.new-todo:visible` timeout) → triage gave up honestly with ZERO model
  calls ("state-gated, not selector drift") — the cypress#7306-class
  proof. Authoring: 3 English steps → Sonnet translated to
  visit/type/assert(have.length), green in one run, cache committed
  (replays are free). TodoMVC leg complete.
- 2026-07-04 Juice Shop leg: #loginButton drift healed by Sonnet to
  [aria-label="Login"] across both spec sites (~500KB Angular DOMs).
  Bugs: comment-defeated sibling probe (includes → string-literal-aware),
  stale-capture model burn + healed-artifact overwrite (same root), jsdom
  CSS spam (VirtualConsole in parseDom). Hygiene lesson: spec comments
  are model-visible — the first give-up proof was contaminated by its own
  scenario comment; reran hint-free and the model refused independently
  ("no plausible target element to remap").
- 2026-07-04 Shoelace leg: source-level shadow drift (esbuild watch beats
  chunk edits); capture carried 185 serialized shadow roots; Sonnet healed
  .dialog__panel to [part="panel"] — the PUBLIC component API, better than
  chasing the renamed internal. Cypress's own shadow limits documented
  live (no cross-boundary combinators; #33046 visibility). healenium#81 +
  cypress#8843 rows proved.
- 2026-07-04 mid-campaign red-team over the fix batch: 2 HIGHs in the
  hook verdict (after-hooks vacuous pass; pending-only pass) fixed —
  verdicts now require >=1 PASSED test; HOOK_TITLE_RE anchored to mocha's
  title shape (user tests mentioning hooks no longer misclassified);
  dedup scoped to deterministic rungs (rerun flake keeps its budget);
  ELECTRON strip scoped to the heal path. CI reworked into the gauntlet:
  parallel rungs + package-hygiene + suite-bites (deterministic mutation
  smoke — found a missing unit pin for apply-then-revert on day one) +
  the showcase job (break -> capture -> heal -> report in the job summary,
  artifacts uploaded).
- 2026-07-04 CRWA leg: data-test drift broke 2 tests; Sonnet healed with
  a 3-edit multi-site heal to button[type=submit]; the second capture
  sibling-healed with zero model calls. Guidance: default selectorPriority
  lacks data-test — adopters using it should configure it. CI gauntlet
  verified fully green via gh (9/9 jobs incl. suite-bites + showcase).
  Campaign totals: 4 new apps + PrairieLearn, 6 real Sonnet heals, 2
  honest give-ups, 1 authored test, 10 goldseam bugs found+fixed+pinned.
- 2026-07-04 authoring sweep: cy.goldseam proved on Juice Shop and
  Shoelace (TodoMVC already done). Two product improvements it forced:
  (1) translate prompt now grounds selectors in the live DOM and uses
  text-contains asserts for elements that don't exist yet (the model had
  guessed a Material snackbar container for a not-yet-rendered error —
  honest red, then green after the prompt fix); (2) the vocabulary gained
  an optional `shadow` host field (cy.get(host).shadow().find(selector))
  because CSS cannot cross shadow boundaries — plain English now drives
  web components, which is open-issue territory for cy.prompt (#33042).
  Note: translation caches key on step text alone — a prompt/model change
  needs the cache file deleted to retranslate (by design; recorded).
- 2026-07-04 live-site probes (throwaway, deleted): example.com,
  Wikipedia, the-internet.herokuapp.com. Verified vague-but-unambiguous
  steps translate grounded; positional language ("the second checkbox")
  disambiguates; and a genuinely ambiguous step ("the checkbox", two
  present) is REFUSED with a precise reason — repeatedly, and from cache
  once refused. Product changes it forced: translation give-up (prompt +
  parse + cached refusal), copy-from-DOM grounding rule (the model had
  emitted legacy-Wikipedia #searchButton from priors), text-contains
  asserts for unseen elements, and translationDom (head/script/style
  stripped — a live Wikipedia head alone blew the 40k budget and forced
  an honest refusal). Learning: fresh translations wobble run-to-run;
  the committable cache pinning a reviewed-good translation is the
  design working as intended. Hidden-state preconditions (Vector's
  display:none search input) still need the toggle step spelled out —
  honest failure, actionable message.
- 2026-07-04 translation eval harness (bench/translate-eval.mjs): 16
  fixture cases across selector cultures (bare ids, data-test, semantic
  classes, aria-labels, Material-style class soup), scoping (table rows,
  positional, shadow DSD), placeholders, unseen-element asserts, and 3
  must-refuse traps — deterministically graded (emitted selectors must
  resolve to the INTENDED element; refusals required where ambiguity
  exists; no LLM judge). Sonnet with the hardened prompt: 16/16 twice
  consecutively, must-refuse 3/3 both runs. Baseline committed; any
  prompt change must hold it. Caveats recorded: fixtures are
  author-written; 16 cases is a floor, grown by adding every future
  failure as a case.
- 2026-07-04 hazard catalog + recursive tuning: .agents/reference/
  hazard-catalog.md (the intercept2 fake-sites move, goldseam-shaped:
  every hazard names ONE runnable example across demo/hazards.html, eval
  fixtures, and unit pins — walls are rows too). Eval grew to 20 cases
  (virtualized-list refusal, dynamic-id stable-hook discipline with
  forbidden-selector grading, split text, portal tooltip). bench/
  translate-tune.mjs closes the intercept2 loop: eval → model revises its
  OWN rules block (generalize-only discipline, keep-only-if-better,
  converge on perfect×2). First run: two hand rules (positional
  legitimacy, label assembly) + one self-tuned rule (interaction-
  triggered content → text asserts, portals named) took 18/20 → 20/20
  held twice. Baseline frozen at 20/20.
