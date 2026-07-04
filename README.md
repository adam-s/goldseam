# goldseam

[![CI](https://github.com/adam-s/goldseam/actions/workflows/ci.yml/badge.svg)](https://github.com/adam-s/goldseam/actions/workflows/ci.yml)

An open, **bring-your-own-model** alternative to Cypress's Cloud-hosted
`cy.prompt()`. Your model — the Claude Code CLI you already have
(`claude -p`) by default, or local Ollama / any OpenAI-compatible endpoint
/ any CLI program — never a vendor cloud, and every result lands as a
reviewable file. **Two tools, kept separate on purpose:**

- **Heal** the Cypress suites you already have — when a selector breaks,
  the failure becomes a rich capture (redacted DOM + accessibility tree +
  error), your model proposes a minimal fix, the suite verifies it, and the
  repair lands as a reviewed diff — never a runtime substitution.
- **Author** new tests in plain English — `cy.goldseam([...])` translates
  your steps once into real Cypress commands, cached as a committable file.

**Why not merge them into one self-healing prompt** (the loop `cy.prompt()`
markets)? When a plain-English step breaks you can't tell whether the app
regressed, the sentence was too vague, or a re-resolve would land on a
plausible-but-wrong look-alike — merged, those compound into a confident
false green. Kept separate, the failure modes stay separable and each tool
stays trustworthy. Full reasoning:
[authored-self-healing.md](.agents/reference/authored-self-healing.md).

Named for kintsugi: the repair is visible, reviewed, and part of the
object's story.

## Install

```bash
npm install --save-dev goldseam
npx goldseam init
```

That's the whole integration. Green runs are untouched; failures write
capture artifacts to `.goldseam/failures/`.

## Heal

```bash
npx goldseam heal          # propose + verify a fix for every capture
git diff                   # review the selector-only edit, then commit
npx goldseam report        # per-test summary of captures and heals
```

Every heal passes a six-rung verification ladder — the indigo rungs judge
offline against the captured DOM; the cyan rungs re-run the app; give-up
and fail are first-class, never hidden:

```mermaid
flowchart TD
    C([broken-test capture]) --> T

    T{"triage<br/><i>selector still matches<br/>the captured DOM?</i>"}
    T -->|"yes — timing, not drift"| G1([give up · reported])
    T -->|no| P

    P["propose<br/><i>model edits selector strings only</i>"]
    P --> R

    R{"resolve<br/><i>fix resolves in<br/>the captured DOM?</i>"}
    R -->|"0 matches / ambiguous · retry (cap 3)"| P
    R -->|"resolves, or deferred"| O

    O{"oracle<br/><i>same identity it had<br/>while green?</i>"}
    O -->|"impostor / identity gone"| G2([give up · reported])
    O -->|"matches, or no oracle on file"| RT

    RT{"rerun-test<br/><i>healed test passes alone?</i>"}
    RT -->|no| F([fail · heal reverted])
    RT -->|yes| RS

    RS{"rerun-spec<br/><i>whole spec passes?</i>"}
    RS -->|no| F
    RS -->|yes| H([healed · selector-only reviewed diff])

    classDef offline fill:#eef2ff,stroke:#6366f1,color:#1e1b4b;
    classDef online fill:#ecfeff,stroke:#0891b2,color:#083344;
    classDef good fill:#dcfce7,stroke:#16a34a,color:#052e16;
    classDef stop fill:#fef2f2,stroke:#dc2626,color:#450a0a;

    class P,T,R,O offline;
    class RT,RS online;
    class H good;
    class G1,G2,F stop;
```

A heal can only ever change selector strings, and gives up loudly when a
fix would be a lie. Models: `claude` (default, via the Claude Code CLI),
`ollama:<model>` (local, zero egress — proven end-to-end on a 14B Qwen),
`openai:<model>` (any OpenAI-compatible endpoint — proven against real
OpenAI; self-host on your own GPU with the [Modal recipe](selfhost/modal/README.md)),
or `cmd:<executable>` (prompt in on stdin, reply out).

## Author

```ts
cy.goldseam([
  'Go to the shop',
  'Add the Ember Mug to the cart',
  'The cart count should show 1',
]);
```

Steps translate once through your model into a fixed command vocabulary
(never `eval`'d code), cached in a committable `.goldseam-prompts/` file
that replays in CI with zero model calls.

Full options, artifact schema, model runners, and guarantees:
[packages/goldseam/README.md](packages/goldseam/README.md).

## Develop

```bash
git clone https://github.com/adam-s/goldseam && cd goldseam
npm install
npm run build:packages
npm run test:unit && npm run test:system && npm run test:hardening && npm run test:heal
```

- `packages/goldseam/` — the plugin + CLI
- `packages/aria-snapshot/` — Playwright's aria snapshot + targeting
  utilities as a standalone package
  ([npm](https://www.npmjs.com/package/aria-snapshot))
- `demo/` + `cypress/` — the fixture shop and the dogfood suite
- `proving/` — real apps, induced drift, real heals
  ([receipts](proving/CAMPAIGN.md))
- `docs/plan.md` — roadmap; `.agents/reference/` — design references

## License

MIT (`aria-snapshot` is Apache-2.0 with NOTICE).
