# Proving campaign — 2026-07

Recursive iteration over real open-source apps. Pattern per app: clone to
`/tmp/goldseam-proving/<app>`, boot locally, write specs in the app's native
selector culture, take a green baseline, induce realistic drift in the copy,
then drive capture → heal (stub for mechanics, real Sonnet for proving
moments) and `cy.goldseam` authoring. Every goldseam stumble becomes a fix +
pinned test + one conventional commit. Real-model calls happen only at
proving moments, never in CI.

| App | Culture | Result |
| --- | --- | --- |
| PrairieLearn | Bootstrap prod monorepo, data-testid | 2 real bugs |
| TodoMVC (js-es6) | semantic classes, zero hooks | 2 heals, 1 give-up, authoring ✓; 5 bugs |
| Juice Shop | Angular Material, id/class/aria soup | aria-label heal, honest give-up; 3 bugs |
| Shoelace docs | web components, shadow DOM | shadow heal to `[part]` API; 185-root capture |
| Cypress RWA | React, data-test everywhere | 3-edit heal + sibling heal (0 calls) |

**Totals:** 4 new apps + PrairieLearn · 6 real Sonnet heals · 2 honest
give-ups · authoring proved on 3 apps · 10 goldseam bugs found, fixed, and
pinned.

## Log

- **TodoMVC.** (1) `.clear-completed→.purge-done` healed by Sonnet (0.97,
  one attempt) after fixing two bugs it exposed: the CLI must strip
  `ELECTRON_RUN_AS_NODE` (VS Code terminals break the rerun rungs), and infra
  failures must abort instead of re-proposing (3× identical model calls
  burned). (2) Hook drift: `.new-todo` broke `beforeEach`, yielding one
  capture titled `todos "before each" hook`. This exposed a correctness bug —
  `rerunVerdictFor` matched by test title, so hook heals could never verify.
  Fixed: hook-title verdicts judge the suite running past the hook, grep is
  skipped for hook titles, identical-proposal dedup stops the retry burn, and
  the weak-assertion window widens to the whole suite for hook heals. (3)
  State-gated scenario (`.new-todo:visible` timeout): triage gave up with
  zero model calls ("state-gated, not selector drift"). Authoring: 3 English
  steps translated to visit/type/assert, green in one run, cache committed.
- **Juice Shop.** `#loginButton` healed to `[aria-label="Login"]` across two
  spec sites (~500 KB Angular DOMs). Bugs fixed: comment-defeated sibling
  probe, stale-capture model burn + healed-artifact overwrite, jsdom CSS
  spam. Lesson: spec comments are model-visible — a give-up proof was
  contaminated by its own scenario comment; rerun hint-free, the model
  refused independently ("no plausible target element to remap").
- **Shoelace.** Source-level shadow drift; the capture carried 185 serialized
  shadow roots; Sonnet healed `.dialog__panel` to `[part="panel"]` — the
  public component API, better than chasing the renamed internal. Cypress's
  shadow limits documented live (no cross-boundary combinators).
- **Mid-campaign red-team.** Two HIGHs in the hook verdict fixed: verdicts
  now require ≥1 PASSED test, and `HOOK_TITLE_RE` is anchored to mocha's title
  shape (user tests mentioning hooks no longer misclassified). Dedup scoped to
  deterministic rungs (rerun flake keeps its budget); the `ELECTRON` strip
  scoped to the heal path. CI reworked into the gauntlet: parallel rungs +
  package-hygiene + suite-bites (deterministic mutation smoke) + a showcase
  job (break → capture → heal → report in the summary).
- **Cypress RWA.** data-test drift broke 2 tests; Sonnet healed with a 3-edit
  multi-site edit to `button[type=submit]`; the second capture sibling-healed
  with zero model calls. Guidance: the default `selectorPriority` lacks
  data-test — adopters using it should configure it.
- **Authoring sweep.** `cy.goldseam` proved on Juice Shop and Shoelace. Two
  product improvements it forced: the translate prompt now grounds selectors
  in the live DOM and uses text-contains asserts for not-yet-rendered
  elements; and the vocabulary gained an optional `shadow` host field
  (`cy.get(host).shadow().find(selector)`), so plain English drives web
  components — open-issue territory for cy.prompt (#33042).
- **Live-site probes** (throwaway: example.com, Wikipedia, the-internet).
  Vague-but-unambiguous steps translate grounded; positional language ("the
  second checkbox") disambiguates; a genuinely ambiguous step is refused with
  a precise reason, and from cache once refused. Forced: translation give-up,
  a copy-from-DOM grounding rule, text-contains asserts for unseen elements,
  and `translationDom` (head/script/style stripped — a live Wikipedia head
  alone blew the 40k budget).
- **Translation eval** (`bench/translate-eval.mjs`). 16 fixture cases across
  selector cultures, scoping, placeholders, and unseen-element asserts, plus
  3 must-refuse traps — deterministically graded (no LLM judge). Sonnet with
  the hardened prompt: 16/16 twice, must-refuse 3/3 both runs. Baseline
  committed; any prompt change must hold it.
- **Hazard catalog + recursive tuning.** `hazard-catalog.md` names one
  runnable example per hazard across the demo, eval fixtures, and unit pins.
  The eval grew to 20 cases (virtualized-list refusal, dynamic-id discipline,
  split text, portal tooltip). `bench/translate-tune.mjs` has the model
  revise its own rules block under generalize-only, keep-only-if-better
  discipline: 18/20 → 20/20, held twice. Baseline frozen at 20/20.
- **External-DOM fixtures.** GitHub login, HN nav, HN two-identical-forms
  scoping — 23/23 first try, Sonnet baseline refrozen. Haiku column: 23/23,
  must-refuse 4/4 — the hardened prompt holds a full model tier down. The
  green-run manifest closed the oracle provenance floor.
- **Runner matrix.** `ollama:` and `openai:` runners shipped with HTTP-shape
  unit pins. The `openai:` runner is proven end-to-end against real OpenAI
  (gpt-4o-mini: request → response → JSON-block parse ✓). A copy-paste Modal
  self-host recipe lives in `selfhost/modal/`, unproven until run on a Modal account
  (CI makes no cloud calls). The air-gapped proof took six probe iterations,
  each finding something real: qwen found the right heal but flubbed JSON
  escaping (→ ollama `format:json` constrained decoding); then truncated
  newString at inner quotes (→ prompt teaches the unquoted `[attr=value]`
  form); then nested confidence inside edits (→ lenient hoist, strict
  validation kept). Final: qwen2.5:14b healed `#cart-count` →
  `[data-testid=nav-cart]` through the full ladder, one attempt, zero egress.
  Limitation: long attribute-quoted selectors can still defeat 14B-class JSON
  escaping — the validator rejects the mangled edit honestly.
