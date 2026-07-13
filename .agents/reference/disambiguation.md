# The disambiguation catalog — healing's ship gate

Status: **catalog complete; guards 1–3 shipped 2026-07** (`triage` +
`resolve` rungs, weak-assertion review flag). This is the companion to
[authored-self-healing.md](authored-self-healing.md): that document argues
the selector is a disposable projection of intent; this one catalogs every
place the healing path must decide *which* projection — or refuse to.

## What "handle" means

Handling a case does not mean healing it. It means making the correct
call, and for the genuinely ambiguous cases the correct call is a loud
give-up or a review flag — never a confident wrong heal. A healer's
instinct is to turn red green, and sometimes red was correct; a healing
tool that turns a real regression green is negative value, because it
makes the suite lie.

So the ship criterion is not a high heal rate. It is **zero wrong-heals
across this catalog** — a give-up on an unhealable case is a pass, and a
wrong-heal on any case is a regression regardless of what else improves.

## The catalog

Verdicts: **heal** (fix the selector), **give up** (report, touch
nothing), **flag** (heal, but mark for human review). "Guarded by" names
the mechanism; every guard has pinned tests in
[heal-resolve.test.ts](../../packages/goldseam/test/heal-resolve.test.ts)
and the heal E2E.

### The heal-or-regression boundary

| # | Case | Correct call | Guarded by |
| --- | --- | --- | --- |
| 1 | Pure locator drift — same element, selector string broke | heal | the whole ladder (worked pre-guards) |
| 2 | Hallucinated target — proposed selector matches nothing | reject → retry | `resolve` rung: zero matches in the captured DOM fails with feedback |
| 3 | Plausible impostor — real target gone, look-alike present | never heal silently | `oracle` rung (shipped 2026-07) when an identity is on file; else rerun assertions + weak-assertion flag |
| 4 | Identity/label change (Submit→Save) behind a stable hook | flag | `oracle` rung when an identity is on file; else weak-assertion review flag |
| 5 | Target removed from the app | give up | rerun fails every attempt → `failed`, spec untouched; model told give-up is a correct answer |

### Target ambiguity

| # | Case | Correct call | Guarded by |
| --- | --- | --- | --- |
| 6 | Healed selector matches several elements, chain expects one | reject → demand specificity | `resolve` uniqueness check (collection chains — `.first()`, `have.length` — exempt) |
| 7 | Weak assertions — only `exist`/`be.visible` survive | flag as low-confidence | `reviewFlags: weak-assertions` on the heal artifact, CLI ⚠, report column |

### Misdiagnosis — not a selector break at all

| # | Case | Correct call | Guarded by |
| --- | --- | --- | --- |
| 8 | Timing/race — element appeared after the retry window | give up | `triage` rung: the "missing" selector still matches the captured DOM |
| 9 | State-gated — present but hidden (`:visible`-style failures) | give up | `triage` with state-pseudo stripping |
| 10 | Wrong page state (never loaded, degraded capture) | give up | `about:blank` + `captureError` short-circuits (pre-existing) |
| 11 | Unmet precondition (auth, seed data, feature flag) | give up | model judgment (prompted); no static signal — open |

### Structural and un-editable

| # | Case | Correct call | Guarded by |
| --- | --- | --- | --- |
| 12 | Dynamic/interpolated/page-object selectors | give up | `oldString` not found → rejected (pre-existing) |
| 13 | Multi-occurrence; selector/assertion straddle | heal all sites / reject | validator (pre-existing) |
| 14 | Cardinality chains (`.eq(2)`, `have.length`) | preserve semantics | `resolve` collection detection permits multi-match only there |
| 15 | Flaky target — verified-green-once isn't verified-always | detect / re-verify | **open** — single rerun today; N-run verification is Phase-2 |

## The guards, and what each closes

1. **`triage`** (pre-model, zero cost): if the selector Cypress could
   never find *still matches the captured DOM*, the element arrived after
   the retry window or is state-gated — no selector edit can fix that.
   Give up before spending a model call. Scoped failures (`Queried from` a
   parent) are skipped — a global count would lie.
2. **`resolve`** (post-propose, pre-rerun, offline): the healed selector
   must resolve in the DOM the model itself saw — the capture. Zero
   matches is a hallucination; several matches where the chain expects one
   is ambiguous; both reject with feedback the next attempt reads.
   `cy.contains` judges by deepest-text match; open shadow roots are
   descended; selectors jsdom can't evaluate are deferred to the rerun
   rungs with evidence, never silently judged. This is also the guard that
   holds when assertions are too weak for the rerun to notice a
   nonexistent target — and it makes `--dry-run` meaningfully stronger.
3. **Weak-assertion review flag** (post-heal, never blocks): a rerun
   proves the healed test *passes*, not that the selector points at the
   intended element. When every surviving check in the enclosing test is
   existence/visibility-only, the heal artifact carries
   `reviewFlags: [weak-assertions…]`, the CLI prints ⚠, and the report
   grows a Flags column. Flags route human attention; they never gate.

## The residual floor

Honest limits, kept in view rather than papered over:

- **The impostor guard needs the manifest turned on** (#3/#4): the
  `oracle` rung rejects heals that abandon the known-good aria identity,
  and `recordOracles` (shipped 2026-07-04) harvests those identities
  automatically on green runs — but it is opt-in. Suites that never
  enable it fall back to the weak-assertion flag and rerun assertions.
- **Scoped selectors get existence-only checks** (#6) — *except the direct
  `cy.get('P').find('C')` shape*, now judged offline: when `P` resolves to a
  single element the `resolve` rung counts `C` within it and rejects a
  look-alike-sibling ambiguity, instead of deferring. A chained/scoped
  parent, `.within()`, a variable subject, or a non-`.find()` scoper still
  counts against the whole document and defers to the rerun (sound, not
  complete — an over-approximation never rejects).
- **Flakes are verified once** (#15): a heal that goes green on a flaky
  test may be a coin flip. N-run verification is a config away
  (`stages` is a list) but not built.
- **Preconditions look like drift** (#11): a login wall produces a real
  page with the target genuinely absent; only the model's judgment (or a
  future page-state heuristic) refuses those.

## The gate itself

Every catalog row has a pinned test asserting the correct verdict — heal,
give-up, flag — with the guards' unit tests and the heal E2E
(hallucination rejected offline; impostor rejected by rerun; strong-path
heal unflagged) as the executable form. The offline eval harness
(capture-fixture cases + deterministic grading, per the prompt-tuning
plan) extends this same catalog into the training set: one case class per
row, ship gate = zero wrong-heals, give-ups grade as passes.
