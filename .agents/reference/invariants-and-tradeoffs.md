# Invariants and accepted tradeoffs — the specifics

[AGENTS.md](../../AGENTS.md) states these as principles. This file holds
the instance behind each one: the mechanism, the file it lives in, and the
cost that was accepted. Both are load-bearing — the principle is what a
new agent must not break, the specifics here are what a maintainer needs
when deciding whether a change is that break.

Rule of placement: when a finding turns out to state something general,
promote the general form into AGENTS.md — which is capped, so the
promotion has to displace a rule it subsumes — and leave the instance
here. This file is pruned too: an entry whose code changed is deleted, not
amended, and a finding that only re-proves a class already listed in
AGENTS.md doesn't get one. Specifics rot; principles don't.

## Capture and redaction

- **`finally { throw err }` + `shouldRethrow()`** in
  [support/index.ts](../../packages/goldseam/src/support/index.ts) — re-throw
  only as the *sole* `fail` listener. With zero listeners Cypress fails tests
  normally; with any listener, only a throw fails the test. Users rely on
  non-throwing handlers to swallow expected failures; our probe showed we were
  overriding them.
- **Final-attempt check in `afterEach`** (same file) — the fail event and
  `afterEach` fire per retry attempt; shipping a capture on a non-final
  attempt poisons the healer with a stale artifact from a flaky-then-green
  test.
- **Redaction runs on a clone, never the live DOM**
  ([support/redact.ts](../../packages/goldseam/src/support/redact.ts)). The DOM
  path strips text-entry control values (`stripControlValues`) and masks
  patterns; the aria path must do BOTH too — `stripAriaControlValues` removes a
  text control's inline typed value (`textbox "Pw": <value>`) *before*
  `maskText` pattern-masks the rest, or a value matching no pattern (a
  password, a name) leaks through the aria YAML. "Text-entry values are never
  captured" is a structural guarantee on both surfaces, distinct from the
  pattern-based redaction of everything else. The capture is the model's input;
  redaction is a capture concern, not polish.
- **`CAPTURE_TASK` is namespaced** (`goldseam:capture`,
  [shared/types.ts](../../packages/goldseam/src/shared/types.ts)) and every
  artifact carries `schemaVersion` — the artifact schema is a public API;
  additive changes bump minor, breaking bump major.
- **Closed shadow roots stay invisible.** Open roots are captured as
  declarative `<template shadowrootmode>` markup; `{ mode: 'closed' }` is
  unreachable by design. Documented in the package README.
- **`cy.origin` blocks degrade** — the support file can't reach cross-origin
  documents; capture falls back to error + URL. Same-origin iframes ARE
  captured (inlined `<template data-frame-content>`); cross-origin frames
  inside a page stay opaque leaves.
- **Dual failure-hooking plugins can mutually defer.** Our sole-listener
  re-throw rule means goldseam + another non-throwing `fail`-listener plugin
  could swallow real failures. Documented; audit support files.
- **Redaction is pattern-based, not semantic.** Emails, digit runs, JWTs,
  hex/base64 tokens, and sensitive query params are masked everywhere including
  the URL; a secret in a format none of those patterns match (short opaque IDs,
  custom encodings, data: URIs) still leaks. The README states exactly what is
  guaranteed.

## The heal ladder

- **Stages are config, verdicts are artifacts.** The ladder is the `STAGES`
  registry in [heal/stages.ts](../../packages/goldseam/src/heal/stages.ts) + a
  `stages: [...]` list; new rungs (oracle, mutation-guard, adversary) are new
  registry entries, never engine refactors. Every rung's verdict lands in the
  heal artifact.
- **The offline rungs are sound, not complete**
  ([heal/resolve.ts](../../packages/goldseam/src/heal/resolve.ts), `oracle` in
  [heal/stages.ts](../../packages/goldseam/src/heal/stages.ts)) — `triage`,
  `resolve`, and `oracle` judge only the captured DOM; a selector they cannot
  statically evaluate — or an oracle with no identity on file — defers to the
  rerun rungs with evidence, never a silent verdict. Stripped-pseudo match
  counts are over-approximations: valid for absence (and triage's still-present
  check), never for uniqueness. Review flags (`reviewFlags`) route human
  attention and never block a heal. Catalog + verdict per ambiguity class:
  [disambiguation.md](disambiguation.md).
- **`validateEdit`**
  ([heal/validate.ts](../../packages/goldseam/src/heal/validate.ts)) enforces
  the heal invariants mechanically: per-occurrence exact-string edits (capped at
  8), failing spec only, each `oldString` unique and verbatim, every change
  confined to a quoted string, no assertion-shaped changes, no line-count
  changes. The model is asked to follow the rules and never trusted to.
- **The engine reverts on any non-healed outcome** and `apply()` is idempotent
  (also called on healed, for propose-only ladders) —
  [heal/engine.ts](../../packages/goldseam/src/heal/engine.ts).
- **`--dry-run` mutates nothing on disk** — the heal-artifact write in
  [heal/engine.ts](../../packages/goldseam/src/heal/engine.ts) is guarded by
  `!dryRun`; a dry-run previews the full ladder to stdout but must never
  overwrite a prior real heal artifact (this once clobbered a video-factory
  demo's recorded `healed` verdict with a preview's `gave-up`).
- **Scoped calls get existence-only resolution — except the direct `.find()`
  shape.** A whole-document count over-approximates within-parent uniqueness, so
  scoped ambiguity defaults to the rerun rungs. The one shape judged offline:
  `cy.get('P').find('C')` where `P` resolves to exactly one element — the
  `resolve` rung counts `C` *within* that element and rejects a
  look-alike-sibling ambiguity (`scopedChildCount` / `directGetParentFor` in
  [heal/resolve.ts](../../packages/goldseam/src/heal/resolve.ts)). Sound, not
  complete: a chained/scoped parent, `.within()`, a variable subject,
  `.children()`/`.filter()`/etc., or a jQuery-pseudo child all return null and
  defer — an over-approximation never rejects.
- **Frame-content matches are noted, not rejected.** A healed selector whose
  only matches live inside inlined iframe content may be legit (a suite with
  frame-entry helpers) or unreachable (bare `cy.get`); the resolve rung notes it
  and lets the rerun decide, while triage names frame-scoping honestly instead
  of calling it timing. Positional oracle judgment models `.first()/.last()/
  .eq(n)` only; other collection chains require every match to carry the
  identity (red-team, accepted).
- **The green-run manifest is opt-in** (`recordOracles`). Without it (or a
  hand-written oracle.json), an impostor satisfying every surviving assertion
  still heals — the weak-assertion flag is the fallback. The harvest is the ONE
  sanctioned exception to "green runs write nothing": it writes only
  `.goldseam/oracle.json`, never captures (E2E-pinned).
- **Retry dedup is scoped to deterministic rungs.** An identical proposal
  failing twice at resolve/oracle aborts (provably futile); rerun-rung failures
  keep the full attempt budget because app flake is real. Trivially-different
  edits still burn budget (accepted).
- **Heal reruns overwrite the original capture artifact.** A rejected edit's
  rerun fails the test, so our own plugin re-captures with the same
  identity/filename. The engine reads the artifact once up front, so heals are
  unaffected; the failures dir just reflects the latest attempt. Revisit if the
  benchmark needs pristine originals.
- **`rerun-test` without `@cypress/grep` reruns the whole spec** — a superset,
  valid but slower. Grep integration is optional by design.
- **Duplicate test titles can confuse rerun verdicts** — `rerunVerdictFor`
  matches by full title; two identically-named tests in one spec could let the
  wrong test's state decide. Rare in practice; index-based matching is the fix
  if it bites (red-team, accepted for now).
- **Heal memory caches by exact `failedSelector` only.** A renamed element
  healed in one spec reapplies anywhere the identical broken selector appears;
  near-miss selectors (same element, different locator style) still go to the
  model. Semantic keying (aria identity) is Phase-2 work.
- **`failedSelector` derives from the MASKED error message** — a selector
  containing a 7+ digit run gets masked before extraction, costing a cache key.
  Correctness unaffected (the model path still heals).

## Prompt assembly — the model's view of the page

- **Prompt DOM slimming is prompt-only**
  ([heal/dom-window.ts](../../packages/goldseam/src/heal/dom-window.ts)) —
  `windowDom` (called by `buildRepairPrompt`) empties `<style>`/`<script>`
  bodies and, when the slimmed DOM still exceeds the ~40 K prompt budget *and* a
  head-first slice contains no anchor, emits a neighborhood window around an
  anchor tied to the failure (asserted spec text first, then a surviving
  *distinctive* sub-part of the broken selector; descends into open-shadow /
  inlined-frame `<template>`s for parity with `resolve.ts`). It never touches
  `artifact.domHtml`: resolution (`countSelectorMatches`/`countTextMatches`,
  `stages.ts`) reads the untouched capture, so the deliberately lossy window can
  never change a match count. The gate is regression-proof — if a head-first
  slice already shows an anchor, today's exact slice is returned unchanged;
  windowing engages only on pages that give up today. The window is a page
  *region* (never a spotlight on the renamed element) and injects no hint; the
  `<!-- goldseam: DOM windowed … -->` marker names the anchor, and the live
  ladder still verifies. Output is hard-bounded by the budget.
- **The no-anchor slice widens to `NO_ANCHOR_FALLBACK_CEILING` (200 K chars).**
  When NO anchor exists anywhere (e.g. an authoring spec with no `cy.contains`
  and a renamed single-token selector) there is no region to center on, so the
  slice becomes a content superset of the old head-first slice — it rescues a
  target sitting deep behind un-strippable chrome (a Squarespace mega-nav pushes
  the blog list to char ~144 K, past the old `2 × budget` floor; emptying
  style/script/svg/comments moves it only ~4 K, so the depth is real DOM, not
  boilerplate) and can never break a heal that worked on the narrower slice. The
  ceiling bounds prompt tokens on a genuinely enormous page; a target past it
  still truncates honestly, just far later. Accepted costs: a capable model pays
  the tokens (~50 K), and a *small-context self-hosted* model handed 200 K
  re-hits the silent-truncate-then-give-up it was meant to avoid — mitigated on
  the ollama path (`ollamaNumCtx`) and, properly, obsoleted by candidate ranking
  ([selector-repair-research.md](selector-repair-research.md)), which removes the
  need to send the deep DOM at all. A 234-case main-vs-branch differential found
  zero regressions. Tune with `NO_ANCHOR_FALLBACK_CEILING` /
  `GOLDSEAM_OLLAMA_NUM_CTX` (red-team, accepted).
- **Windowing anchors on light-DOM/template content only, and degrades honestly
  when it can't.** Known give-up cases (all no worse than the pre-windowing
  head-first slice, all caught by the live ladder): (a) an *ambiguous* spec-text
  anchor that also appears early — the gate finds it in the head and keeps
  head-first rather than window a wrong region; (b) an anchor genuinely far from
  the target (different page section → their subtree is over-budget); (c) a
  *bare-tag-only* broken selector (`nav > ul > li`) — no distinctive piece
  survives, so no structural anchor; (d) `deepestTextBearer` picks the first
  document-order bearer when asserted text repeats. `searchScopes` descends one
  template level (nested open-shadow-in-shadow is not walked). Landmark/`<main>`
  -by-size anchoring was deliberately dropped — probing showed "largest
  container" is an unreliable anchor. Fuller future levers if a page still
  overflows: emptying inline `style=""` attributes, and ranking multiple
  candidate anchors instead of first-match.
- **The candidate-ranking shortlist and its confident-shrink**
  ([heal/rank.ts](../../packages/goldseam/src/heal/rank.ts),
  [heal/prompt.ts](../../packages/goldseam/src/heal/prompt.ts)).
  `rankCandidates` scores selectors in the post-break capture by fit to the heal
  intent (spec's `have.length`/text assertions, aria, structural homogeneity,
  and a proportional name-overlap with the broken selector) and
  `buildRepairPrompt` embeds the top-K shortlist — a compact list the model
  disambiguates from. Two behaviors, two trust postures: (a) the shortlist is
  added to EVERY prompt (small; helps every model; never replaces the DOM; the
  model still grounds its edit in the capture and resolve/rerun verify — worst
  case give-up, never a wrong heal). (b) When the capture OVERFLOWS the DOM
  budget AND the top candidate is STRONGLY confident (score ≥ 0.7), the embedded
  DOM is shrunk (24 K) and windowed on the candidates, dropping a deep prompt
  from ~50 K to ~5 K tokens so a small self-hosted model heals it (proven: local
  qwen2.5-14b and the openai runner → Modal both heal the epsilon3 deep case;
  the Modal recipe dropped back from A100/64 K-YaRN to L40S/32 K as a result).
  The shrink is NOT strictly additive — a confidently-WRONG ranking could window
  away a target the full no-anchor slice would have shown, turning that heal into
  a give-up (never a wrong heal; resolve/rerun still verify). It is gated on the
  high confidence bar to make that rare, `windowDom`'s head gate ignores
  `anchorSelectors` so an early candidate can never truncate the window to a head
  slice that bypasses `NO_ANCHOR_FALLBACK_CEILING` (the red-team regression), and
  the full shortlist is still present as the model's safety net. Two accepted
  costs: ranking is O(unique-selectors × N) and DEFERS (returns `[]` → full DOM)
  above `MAX_RANK_ELEMENTS` (20 K) rather than spend seconds on a pathological
  capture; and by spotlighting a count-matching candidate under a count-only
  (weak) assertion, the shrink makes the pre-existing weak-assertion hole
  (`isWeaklyAsserted`/`reviewFlags`) marginally more reachable — flagged for
  review, never blocking (red-team, accepted).
- **DOM truncation can cut mid-tag** at `maxDomBytes`. Harmless for the model;
  not worth an HTML-aware slicer yet.
- **`ollamaNumCtx` trades a silent truncation for a possible OOM.** Sizing
  `num_ctx` to the prompt (chars/3 + headroom, capped at 131 072) means a large
  prompt now requests a large KV cache; most Ollama builds clamp to the model's
  trained context, but one that honors it literally can OOM/stall on tight VRAM
  where before it silently truncated. An honest failure beats a silent lie, so
  this is the right default; a memory-tight host caps it with
  `GOLDSEAM_OLLAMA_NUM_CTX`. The chars/3 estimate can still under-size very dense
  markup at the edge (red-team, accepted).
- **The `openai:` runner requests `response_format: json_schema`; an endpoint
  that rejects it (older vLLM, llama.cpp, some proxies) is retried ONCE
  unconstrained** ([heal/runners.ts](../../packages/goldseam/src/heal/runners.ts))
  — so json_schema's reliability (plain `json_object` sends vLLM's decoder into a
  `finish_reason=length` runaway; measured) never costs compatibility. The
  degrade is scoped to schema-shaped 400s, so a context-length 400 (which a retry
  can't fix) still surfaces. A reply that overruns `max_tokens` (8 192) fails safe
  (unparseable → give-up), not silently (red-team, resolved + accepted).

## Authoring

- **Authoring verifies every translated selector against the captured DOM**
  ([plugin/translate-verify.ts](../../packages/goldseam/src/plugin/translate-verify.ts))
  — authoring has NO rerun rung, so a hallucinated selector (one that matches
  nothing in the DOM the model saw) is caught here or never. `translateSteps`
  runs `verifyCommands` after `validateCommands`; a sound zero-match triggers a
  retranslate with feedback naming the selector (capped at
  `MAX_VERIFY_RETRIES`), then a cached give-up — a non-resolving selector is
  NEVER shipped. The soundness rules mirror heal `resolve`: only commands BEFORE
  the first `visit` are grounded (post-navigation selectors target a page the
  capture doesn't hold — checking them would be a false rejection);
  `assert`/`visit` are never verified; a selector the CSS parser can't evaluate
  (jQuery pseudo) is ACCEPTED, never rejected. The guarded re-derive
  (`rederiveUnresolved`) substitutes a selector only on a UNIQUE, verified
  identity — exactly one strong anchor text (quoted/proper-noun) resolving to
  exactly one element whose derived selector resolves back — and only when a
  single command failed; any ambiguity defers to retranslate. It never guesses.
- **Verify is scoped and single-target by design.** Grounding only the commands
  before the first `visit` means verify has teeth mainly when the author is
  already on the target page (the heal-a-page and single-page-app cases). The
  single-step gate on re-derive is load-bearing: no command→step provenance is
  tracked, so with several steps the winning anchor could belong to a DIFFERENT
  step than the failing command, and patching that command with it is a
  cross-step impostor (red-team finding — `["Click the \"Ember Mug\"", "Submit
  the form"]` where Submit hallucinates). Multiple simultaneous hallucinations, a
  multi-step list, or a target with no quoted/proper-noun name go straight to
  retranslate rather than risk a mis-map. Shadow-scoped selectors are
  existence-checked (host present + inner selector matches inside it) but never
  re-derived. All conservative: the honesty rule is "never ship a non-resolving
  selector, never guess an ambiguous one" — a deferred selector is one the model
  still answered for, not invented.
- **The translate prompt's page representation is opt-in and the raw-DOM window
  is the default** (`renderPageBlock` in
  [plugin/translate.ts](../../packages/goldseam/src/plugin/translate.ts)).
  `'dom'` (default, or `representation` unset) emits the historical
  step-anchored raw-DOM window byte-for-byte — the default authoring path must
  stay unchanged. `'aria'` (config-only, `author.representation`) swaps in
  `ariaOutline`
  ([plugin/aria-outline.ts](../../packages/goldseam/src/plugin/aria-outline.ts)):
  a compact, selector-carrying accessibility outline whose selectors come from
  `deriveSelector` (verified unique) so the model copies a known-good locator
  instead of inventing one. `ariaOutline` NEVER throws and returns `null` on an
  un-walkable page (parse error, empty/closed-shadow-only tree, no interactive
  node with a selector); `renderPageBlock` then falls back to the raw-DOM window
  — so `'aria'` is never worse than `'dom'`. It composes with verify unchanged:
  an aria-derived selector still runs `verifyCommands` (and passes, being
  unique-by-construction).
- **The prompt cache (`.goldseam-prompts/`) does not invalidate on a model
  change.** `promptKey` is FNV-1a over the steps joined on a NUL delimiter (never
  a literal space — a space would collide `["a b","c"]` with `["a","b c"]` and
  rekey every committed file), and the entry records `model`/`schemaVersion` but
  only `schemaVersion` gates the load. Switching the configured model reuses a
  committed translation by design — a reviewed, git-shared translation shouldn't
  silently invalidate because someone reconfigured a model; delete the entry (or
  edit a step) to retranslate. (Cross-machine NUL vs NFC filename note: two
  Unicode normalizations of the same step text key differently, a spurious miss
  the load-time step recheck makes harmless — efficiency only, `.normalize('NFC')`
  deferred until churn is observed since it would also rekey existing entries.)
- **A `not.exist` disappearance assert can pass vacuously (accepted).** The
  outcome-assert prompt rule emits `{selector, should:'not.exist'}` for a named
  disappearance; `verifyCommands` deliberately does NOT verify `assert` targets
  (an assert may legitimately point at future-state content), so a model that
  picks a never-present selector yields an assertion that passes testing nothing.
  Low-likelihood (the rule fires only when the step names a disappearance and the
  model usually names the real element); a future guard could confirm a
  `not.exist` target WAS present in the pre-action capture, but that risks
  false-rejecting a legitimate "already absent" assertion, so it is deferred. The
  `firstBalancedObject` reply-scan errs safe (a wrong slice from leading JSON-ish
  prose fails to parse → retranslate/give-up, never accepts a weakened edit), and
  `selector-score`'s short-prefix-counter heuristic can flag a human id like
  `#page404` as volatile — review-only, never blocks, the reason is shown (both
  red-team, accepted).
- **The authoring settle is best-effort and capture-path-only.**
  `waitForDomStable`
  ([support/settle.ts](../../packages/goldseam/src/support/settle.ts)) runs
  INSIDE `cy.goldseam` before the FIRST-run translation capture only — never the
  cache-hit replay, never the general suite — so the transparency invariant
  holds: a suite behaves identically with and without goldseam, the settle
  affects only the command the author explicitly wrote. It never touches global
  listeners, fully disconnects its MutationObserver on resolve, and never throws
  (any failure degrades to capturing immediately). It is opt-out (`settle:
  false`/`0`, per-call or via `Cypress.env('goldseam')`) and the cap is tunable.
  Known limits (all no worse than the pre-settle eager capture): (a) a page that
  NEVER quiesces (animations, polling) is captured at the `maxMs` ceiling,
  possibly mid-paint — verify catches a hallucinated selector, the author
  retries; (b) content that arrives LATER than the cap is still missed — raise
  `settle` for a known-slow page; (c) quiescence is DOM-mutation only, so a
  network fetch that hasn't painted yet reads as quiet. A fixed `cy.wait` was
  rejected: too short misses slow content, too long taxes every static page;
  watching mutations self-tunes.

## Performance — measured, accepted

- **No unbounded leak; jsdom windows are closed as hygiene.** A measured leak
  audit (async-realistic, event-loop-turning runs on 1 MB captures) found heap
  *plateaus*, not growth: the engine `await`s a macrotask (`runner.repair`,
  `cypress.run`) between heals, so per-heal jsdom windows are reclaimed. The
  module-level caches, the `fail` listener, the `cmd:` child, and aria-snapshot's
  refcounted `beginAriaCaches`/`endAriaCaches` (`finally`-released
  `Map<Element>`) were all cleared. Still, `parseDom` consumers release their
  window through `closeWindow`/`withParsedDom`
  ([heal/dom-env.ts](../../packages/goldseam/src/heal/dom-env.ts)) in a `finally`
  after the last read — correct jsdom lifecycle, and a guard so a *future* tight
  synchronous parse loop (no `await`) can't OOM. Behavior-neutral: the release
  runs after counts/verdicts (plain values) are computed.
- **`countTextMatches` and `deepestTextBearer` are O(N × subtree) on very large
  DOMs** ([heal/resolve.ts](../../packages/goldseam/src/heal/resolve.ts),
  [heal/dom-window.ts](../../packages/goldseam/src/heal/dom-window.ts)) — each
  reads full `textContent` per element and per child, ~2.7 s on a synthetic 36 K
  -element capture. Correct and bounded (offline, fires only on a `cy.contains()`
  edit), just slow on pathological pages; a single post-order accumulation would
  linearize it. Deferred: a speed fix on a trust-adjacent counter needs an
  exact-semantics parity test, and the maintainer deprioritized speed for this
  pass (measured, accepted).
- **The oracle rung's aria-tree build does not scale to giant DOMs** —
  `getAllByAria` over a 36 K-element capture did not finish in minutes
  (`generateAriaTree` visits every node computing roles/names). The rung is
  opt-in (`recordOracles` or a hand-written `oracle.json`); on such a page it
  would dominate the heal. No fix — the aria-walk cost is inherent, not a bug —
  but recorded so a future scaling pass has the number (measured, accepted).

## Environment

- **`cmd:` runner splits on whitespace** — executable paths containing spaces
  need a wrapper script. No shell is involved, so this is a usability limit, not
  an injection risk (red-team, accepted).
- **`goldseam heal` strips ELECTRON_RUN_AS_NODE for its own children** — an
  exotic `cmd:` model runner that is itself an Electron binary needing that var
  would break; wrap it in a script that re-sets it.

## Known noise — expected output that is not a problem

- Cypress 15 prints an `allowCypressEnv` deprecation warning on every
  Module-API run — upstream, cosmetic.
- Markdown table-pipe lints (MD060) in docs — cosmetic.
- jsdom lacks pseudo-element `getComputedStyle`; unit tests shim it (see
  [support-invariants.test.ts](../../packages/goldseam/test/support-invariants.test.ts)).

## Fixtures

- **The demo shop's selector texture is deliberate**
  ([demo/js/shop.js](../../demo/js/shop.js)) — ids, classes, `data-testid`, and
  hook-free elements mixed on purpose; specs and future mutation branches rely on
  that mix. Don't "clean it up".
