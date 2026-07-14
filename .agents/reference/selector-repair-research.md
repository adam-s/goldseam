# Selector-repair techniques: research synthesis

Why this exists: healing a deep or match-many page by handing the whole DOM to
a model is the wrong shape, and the field already knows it. This is the
evidence — industry, academia, DOM-for-LLM compression, and the ML ranking
literature — and the architecture it points goldseam toward. Four independent
research passes (2026-07-14) converged on the same answer, below.

## The problem, stated precisely

A heal must emit a **CSS selector** (a `class`/`id`/`data-*`/attribute string),
not merely point at an element. That one requirement governs everything:

- **Huge DOMs.** A real page's captured DOM runs 100K–500K characters. Epsilon3's
  blog list sits at char ~144K behind a 361-link Squarespace nav; the no-anchor
  prompt is ~55K tokens. Measured: emptying `<style>/<script>/<svg>`/comments
  moves the target only ~4K (the bulk is real nav markup); attribute-pruning
  barely helps (the bloat is `class` + `data-*` + structural tags, all
  selector-relevant); windowing to `<main>` only reaches ~46K tokens (the content
  region is itself large). No single prompt transform gets a page like this under
  a stock 32K context while keeping the class the heal must output.
- **Match-many.** The target is often a *set* — 21 blog cards under one class,
  asserted with `have.length.at.least`. The repair is a token that re-selects the
  *set*, not a unique element.
- **Model reliability.** On the huge, noisy prompt a mid-size self-hosted model
  (Qwen2.5-14B) fixates on the wrong selector, mis-copies the `oldString`, or —
  under `response_format: json_object` on vLLM — runs the decoder away to
  `finish_reason=length`. Sonnet heals the same cases cleanly. The prompt shape
  and the model capability are coupled failures.

The naive fix (widen the DOM window, serve a 64K-context model on an A100) is
what `NO_ANCHOR_FALLBACK_CEILING` does today. It is correct and it works, but it
is the expensive shape. The research points at the cheap, robust shape.

## The convergent finding

**Score candidates offline with a weighted element-similarity fingerprint;
hand the model a small ranked shortlist to disambiguate — never the raw DOM.**

Every stream landed here independently:

- **Industry / OSS** (Healenium, `ShantanuVr/playwright-self-healing-framework`,
  Testim, mabl, Functionize): the dominant design is a **deterministic weighted
  fingerprint** scored over live DOM nodes — *no LLM in the hot path*. Published
  weights agree: **visible text highest (~0.45), anchor/label/aria/sibling
  context next (~0.20), tag/attributes/classes ~0.10 each, `id` lowest (~0.05,
  because ids churn first)**. The closest analog to goldseam that *does* use an
  LLM on the whole DOM (an LLM-PR Cypress healer) reports only **~40% accuracy
  when the element changed**, and blames "the full DOM overwhelms the model" —
  external confirmation of exactly our failure.
  Sources: <https://github.com/healenium/healenium-web>,
  <https://healenium.io/docs/how_healenium_works>,
  <https://github.com/ShantanuVr/playwright-self-healing-framework>,
  <https://itnext.io/self-healing-e2e-tests-reducing-manual-maintenance-efforts-using-llms-db35104a7627>,
  <https://www.mabl.com/auto-healing-tests>,
  <https://www.functionize.com/automated-testing/self-healing-test-automation>.

- **Academia** — **Similo** (Nass et al., ACM TOSEM 2023,
  <https://dl.acm.org/doi/10.1145/3571855>, preprint
  <https://arxiv.org/abs/2208.00677>) is the SOTA feature/weight recipe: a
  **14-property fingerprint** (Tag, Visible Text, Class, ID, Name, HRef,
  Location, Area, Shape, Alt, Is-Button, XPath, Neighbor Text) scored as a
  weighted sum, **stable properties (tag/name/id) weight 1.5, unstable
  (class/href/alt/xpath) weight 0.5**. On a realistic 4-month-interval benchmark
  of 10,376 pairs it hits **99% exact-match** (Web Element Relocalization, EMSE
  2026, <https://arxiv.org/html/2505.16424>). **VON Similo LLM** (STVR 2024,
  <https://onlinelibrary.wiley.com/doi/10.1002/stvr.1893>, preprint
  <https://arxiv.org/abs/2310.02046>) is the pattern closest to goldseam: rank
  all candidates offline, keep the **top-10**, serialize each to JSON with its
  properties, and ask the LLM to pick the `widget_id` — the model sees a
  shortlist, never app source. Predecessors establish the same shape: **COLOR**
  (SANER 2019, learns per-property weights from version diffs), **WATER** (the
  original differential DOM repair — and a caution: its assertion "repair"
  replaces expected-with-actual, precisely the weakening goldseam forbids),
  **ROBULA+/SIDEREAL** (robust XPath synthesis — what `deriveSelector` already
  does), **Multi-Locator** (ensemble/voting).

- **DOM-for-LLM compression** (Mind2Web/MindAct
  <https://arxiv.org/abs/2306.06070>; AutoWebGLM
  <https://arxiv.org/abs/2404.03648>; D2Snap "Beyond Pixels"
  <https://arxiv.org/abs/2508.04412>; Prune4Web
  <https://arxiv.org/abs/2511.21398>): the compact-but-lossy defaults —
  **accessibility tree and Set-of-Marks are DISQUALIFIED** for selector-writing
  because they drop the `class`/`data-*` strings you must output. (This is why
  goldseam's authoring `ariaOutline` cannot serve heal directly: `deriveSelector`
  yields *unique* `nth-of-type` paths, not the shared class a match-many heal
  needs — measured.) The winning stack is **retrieval → attribute-preserving
  pruning → template-collapse**: MindAct ranks to top-K then feeds the model;
  AutoWebGLM keeps interactive nodes + ancestor chain + whitelisted attributes;
  D2Snap tunes attribute-downsampling *up* (keep attributes) for selector work
  and even *raises* accuracy (65%→73%) at comparable tokens. Repeated elements
  are the literature's weakest spot — the actionable idea is **template collapse**
  (show the first *k* siblings sharing a tag+class signature verbatim, then a
  `<!-- N similar collapsed -->` marker), which preserves the pattern *and* tells
  the model the match count.

- **ML / scikit-learn**: the proven combiner is the **weighted sum** (ship first,
  no training). The sklearn upgrade is a **GradientBoostingClassifier over the
  ~15-D per-feature similarity vector** (`predict_proba` as the ranker), with
  labels generated **self-supervised from goldseam's existing DOM-mutation
  machinery** (rename class/id, reorder, wrap, perturb text — the correspondence
  is known by construction; the same mutation engine that powers `suite-bites`).
  An unsupervised day-one baseline: `NearestNeighbors(metric='cosine')` over
  `TfidfVectorizer(text)+TfidfVectorizer(neighborText)+DictVectorizer(tag/role/class)`.
  Learning-to-rank framing: Nass et al., JSS 2024,
  <https://www.sciencedirect.com/science/article/pii/S0164121224003303>.

## Recommended architecture for goldseam

A new **offline ranking rung** between capture and the model, reusing the ladder
goldseam already has (`STAGES` registry, `heal/stages.ts`). Sound, not complete —
it defers to the model when nothing scores well, exactly like the other offline
rungs.

1. **Fingerprint the broken target.** From the failing selector + the captured
   DOM + aria tree, record a Similo-style fingerprint. goldseam already captures
   the two surfaces the field converged on: the DOM (tag/class/id/attrs/xpath)
   and the aria tree (role ≈ Is-Button, accessible name ≈ Name, neighbor text).
   Layout features (location/area) are optional — a jsdom capture has no boxes;
   lean on text/neighbor-text/aria, which we do have.

2. **Score candidates offline.** Weighted sum first (Similo weights: stable 1.5,
   unstable 0.5 — and note this *down-weights `class`*, which is what breaks, and
   up-weights id/name/role/text/neighbor-text). Keep the top-K.

3. **Match-many token scoring.** When the assertion is match-many, score candidate
   *tokens* (each `class`/`data-*` value on ≥2 elements) not single elements:
   `w1·(coverage·overlap_quality) + w2·count_similarity + w3·homogeneity`, where
   coverage/overlap come from per-element Similo matching of the original set to
   the token's set (Hungarian assignment,
   `scipy.optimize.linear_sum_assignment`), count_similarity rewards
   `|S_t| ≈ N`, and homogeneity rewards a structurally-uniform set. `count_sim`
   and `homogeneity` need no training and can ship as heuristics. This is the gap
   the single-element self-healing literature leaves open.

4. **Hand the model a shortlist, not the DOM** (VON Similo LLM). The model call
   becomes a bounded disambiguator over K pre-scored candidate fingerprints +
   the target description — small prompt, small model viable, no A100/64K, and
   hallucination bounded to choosing among real candidates. Fall back to the
   windowed-DOM prompt only when ranking is inconclusive.

5. **Ground the pick** — goldseam's edge over all of this. None of the surveyed
   work re-resolves the proposed locator against the exact captured DOM the model
   saw; goldseam's `resolve`/`verifyCommands` rungs do. A ranked-then-picked
   selector still passes the match-count gate or it is rejected. Keep that.

### What this buys

- **Kills the huge-DOM prompt** — the token blow-up, the YaRN/A100 requirement,
  and the model's noise-fixation all come from sending the raw DOM. A shortlist
  is a few hundred tokens.
- **Makes the self-hosted small-model path viable** — the reason the 14B failed
  was the prompt, not (only) the model. A 14B picking among 10 fingerprints is a
  far easier task than a 14B writing a selector from 55K tokens of nav.
- **Handles match-many directly** via token set-scoring, instead of hoping the
  model reads 21 cards correctly.

### Invariant notes

- The ranking rung is **sound, not complete** — an over-approximate score never
  *rejects*; a low top score **defers to the model**, never forces a pick. VON
  Similo's 13/804 "true element not in top-10" cases are the recall ceiling that
  validates goldseam's give-up-as-first-class rule.
- The shortlist is a set of *candidate identities the model chooses among*, which
  is a softer posture than the "never spotlight the renamed element" concern
  around a single-anchor window — but it still carries a version of it: the
  shortlist must be **ranked by durable identity (text/aria/neighbor), not by
  substring-match of the broken token**, or it degenerates into handing the
  answer. Down-weighting `class` (Similo's prior) is what keeps it honest.
- Down-weighting `class` also makes heals **durable**, not just correct
  (ROBULA+/SIDEREAL/COLOR): prefer id/role/name/text-anchored selectors so the
  heal does not re-break next redesign.

## Relationship to what shipped

`NO_ANCHOR_FALLBACK_CEILING` (the G1 fix) is the **interim** correctness fix: it
makes the deep target visible to a capable model (Sonnet heals epsilon3-class
pages; proven end-to-end via the `claude` and Modal `openai:` runners). The
ranking rung is the **efficiency and small-model** answer that removes the need
to send the deep DOM at all. They compose: ranking first, windowed DOM as the
fallback the ceiling still governs.

## Evaluation

- **Benchmarks:** ReproBreak (<https://arxiv.org/html/2605.12158v1>) and the
  10,376-pair realistic-interval set from the relocalization study — both fixed
  the unrealistic 12–60-month version gaps that inflated older results.
- **Labels for the learned ranker:** generate from goldseam's DOM-mutation engine
  (the `suite-bites` machinery) — known correspondence, no manual labeling.
- **Metric:** top-1 and top-K recall of the ranker offline; end-to-end heal rate
  and give-up honesty with the shortlist-fed model, across the supported-site
  suite, on both the default (Sonnet) and self-hosted (Qwen) runners.

## Primary sources

Similo (TOSEM 2023) <https://arxiv.org/abs/2208.00677> · VON Similo LLM (STVR
2024) <https://arxiv.org/abs/2310.02046> · Web Element Relocalization (EMSE 2026)
<https://arxiv.org/html/2505.16424> · Ranking approaches (JSS 2024)
<https://www.sciencedirect.com/science/article/pii/S0164121224003303> · ROBULA+
<https://onlinelibrary.wiley.com/doi/10.1002/smr.1771> · COLOR (SANER 2019)
<https://ieeexplore.ieee.org/document/8667976/> · WATER (ETSE 2011)
<https://dl.acm.org/doi/10.1145/2002931.2002935> · VISTA (FSE 2018)
<https://people.ece.ubc.ca/amesbah/resources/papers/fse18-vista.pdf> · SIDEREAL
(STVR 2021) <https://onlinelibrary.wiley.com/doi/10.1002/stvr.1767> · Mind2Web
<https://arxiv.org/abs/2306.06070> · AutoWebGLM
<https://arxiv.org/abs/2404.03648> · D2Snap <https://arxiv.org/abs/2508.04412> ·
Prune4Web <https://arxiv.org/abs/2511.21398> · Healenium
<https://github.com/healenium/healenium-web> · playwright-self-healing-framework
<https://github.com/ShantanuVr/playwright-self-healing-framework> · LLM-PR
prototype
<https://itnext.io/self-healing-e2e-tests-reducing-manual-maintenance-efforts-using-llms-db35104a7627>.
