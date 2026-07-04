# Authored self-healing: the semantics, and why we defer it

Status: **deferred** (2026-07-03). Design captured here; no code. This
records the reasoning so a later session picks up the argument, not just
the conclusion.

## The question

cy.prompt markets one loop: write a step in plain language, and when the
UI shifts it "self-heals." Should `cy.goldseam()` do the same — bridge our
plain-language authoring to our healing so an authored step repairs itself
when it breaks?

## What exists today

Two separate, working pieces:

- `cy.goldseam(steps)` translates plain-language steps into a constrained
  command list once, through your model, and caches the result as a
  committable file.
- `goldseam heal` repairs broken selectors in hand-written `cy.get` suites
  and delivers the fix as a reviewed commit.

They are not connected. An authored step whose selector breaks does not
self-heal. Closing that gap is what this document is about.

## The semantic core

The intent is the durable thing. `"click the submit button"` is what the
author meant. The selector the translator produced —
`cy.get('[data-testid="submit"]')` — is a *cached projection* of that
intent: shorthand for "the element I already worked out the sentence
meant." Brittleness comes entirely from mistaking the projection for the
intent, from treating the frozen selector (or the literal label text) as
the source of truth when it is only a derived pointer.

Follow the projection trap through a single change: a button's label goes
from SUBMIT to SAVE.

- If the step froze as `[data-testid="submit"]` and the testid did not
  change, the test passes. Green. It now clicks a button the app calls
  "Save" while the test says "submit" — possibly asserting the wrong
  thing, silently. A false green, the worst outcome a test tool can
  produce.
- If the step froze as `contains('Submit')`, the selector matches nothing
  and the test fails. The selector was not wrong; it faithfully encoded
  "the button that says Submit," and the text moved under it.

Same event in the world, opposite test outcomes, decided entirely by which
projection the first translation happened to pick. So "was the selector
the problem?" is not a well-posed question. The selector is a disposable
cache; asking whether it "broke" is asking about the shadow, not the
object.

The correction: keep the plain language as the source of truth and
*re-resolve it semantically* against the live page when the cache misses.
A model reading the page identifies the submit button by what it is — the
form's primary submit control, its role, its position, its behavior — not
by the literal string "Submit." Under that model, renaming a testid,
swapping a class, restructuring the DOM, and tweaking a label all resolve
correctly, because none of them changed what the sentence refers to. You
do not hunt for a replacement selector string; you re-resolve the sentence
and re-cache the answer. There is nothing to "heal."

## What semantic resolution solves, and its floor

Re-resolution handles the churn that dominates real maintenance: renames,
re-skins, DOM moves, label edits. That is most of why suites rot, and
semantic matching makes it a non-event.

It does not remove one irreducible floor: re-resolution can be
*confidently wrong*. Three cases where the sentence stops having a clean
referent:

1. **Referent gone.** The submit button was deleted. The match finds
   nothing. Honest failure — the intent no longer maps; a human decides.
2. **Ambiguous.** The page now has "Submit for review" and "Submit and
   publish." "The submit button" under-specifies. A human disambiguates.
3. **Plausible impostor.** The real submit button was removed and replaced
   by "Save draft," which looks like the primary action but does something
   different. A semantic matcher grabs it and goes green — and the test now
   exercises the wrong behavior. The author only said "submit button"; the
   machine cannot know "Save draft" is not what they meant.

Case 3 is the danger. Semantic understanding raises the ceiling but does
not remove the floor: a wrong-but-plausible match is a semantic error the
machine cannot self-certify, precisely because it resolved with
confidence. This is the same trap that makes runtime self-healing risky in
general — a healer's instinct is to make red turn green, and sometimes red
was correct. A submit flow that broke and left only a "Save draft" button
*should* fail the test. "Healing" it hides a real regression.

For an authored step this is our "heals never weaken assertions" invariant
one level deeper: the described intent, and the meaning of the element it
targets, are part of what the test asserts. Re-pointing the step at a
plausible impostor quietly rewrites what the test proves.

## Why we do not proceed now

1. **It is not the wedge.** goldseam's reason to exist is healing the
   hand-written `cy.get` suites that make up the installed base — the ones
   cy.prompt cannot touch because it only heals its own prompt-authored
   steps (see [plugins/competition.md](../../docs/plugins/competition.md)). Authoring
   is parity, a box we can point to, not the pillar.
2. **Doing it well is substantial.** The honest version is not "re-run the
   translator." It needs an intent anchor recorded on first pass (the aria
   identity the step acted on, which our capture already produces),
   semantic re-resolution against the live page, a three-way triage
   (drift / gone / ambiguous), verification of every resolution, and a
   guard against the case-3 false green. That is a feature, not a patch.
3. **Doing it badly is worse than not doing it.** A healing tool that
   turns a real regression green is negative value — it makes the suite
   lie. Until the case-3 guard is designed, shipping authored self-healing
   would trade our one advantage (trust) for a demo.
4. **It fights on the incumbent's turf.** Plain-language authoring is where
   Cypress is strongest: cloud models, polish, a head start. Pouring
   investment there spends it where we are weakest and copies a product
   instead of beating one.
5. **Separate is better DX, and this reinforces it.** Authoring and healing
   are different moments — writing versus triaging a break — with different
   failure modes (a bad translation means the model misread your sentence;
   a bad heal means it picked the wrong element). Two sharp verbs, each
   learnable in one line and each internally complete, beat one command
   whose behavior depends on the provenance of the step. Predictability is
   the DX for a tool whose whole promise is "nothing changes behind your
   back."
6. **It deserves design on paper first.** This document is that paper.

## What would change the decision

Proceed when both hold: authoring shows real usage (someone is actually
writing `cy.goldseam` steps and hitting the break-and-recover moment), and
the semantic loop is specced — resolve by meaning, cache the projection,
re-resolve on miss, verify, and escalate on absence, ambiguity, or a
meaning-changing match. The anchor and the case-3 guard are the parts that
must be designed before any code, because they are the parts that keep the
tool honest.

## What we do instead now

Keep the two paths separate and each complete. Invest in the pillar:
heal more selector styles, build the oracle rung
([plugins/verification-ladder.md](../../docs/plugins/verification-ladder.md)), ship
PR delivery, grow the benchmark. If the authoring path ever needs recovery
before the full loop is built, the honest minimum is to re-resolve from
the sentence and verify, never to string-hunt a replacement selector — but
even that waits until the reasoning above is answered, not assumed.

The principle to carry forward, stated once: **intent is the source of
truth; the selector is a verified cache; re-resolve, do not string-hunt;
escalate on ambiguity or a change in meaning.**
