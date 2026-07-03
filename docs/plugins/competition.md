# Healing competition — the landscape and the DX bar (2026-07)

Who else heals tests, what adopting them costs a developer, and exactly
where goldseam beats each. Sources: vendor docs/sites verified 2026-07-03;
cy.prompt detail in [cy-prompt-anatomy.md](cy-prompt-anatomy.md) and
[cy-prompt-usage.md](cy-prompt-usage.md).

## The field

| Tool | Heals what | Integration cost | Where the fix lives | Model |
| --- | --- | --- | --- | --- |
| **cy.prompt** (Cypress) | Its own prompt-authored steps only | Rewrite tests as English prompts + Cloud account/record key | Runtime + Cloud cache; eject forfeits healing | Cypress Cloud only |
| **Healenium** (OSS) | Selenium locators at runtime | Docker backend + PostgreSQL + proxy/driver wrap | Runtime substitution; report UI | Built-in ML (LCS-based), no BYO LLM |
| **CodeceptJS `heal`** (OSS) | CodeceptJS steps at runtime on CI | Adopt CodeceptJS wholesale + recipes file + AI provider config | Runtime retry with suggested code | BYO (OpenAI/Claude/etc.) |
| **mabl / Testim / Octomind / QA Wolf class** (commercial) | Tests recorded/generated inside their platform | Move testing into the platform (trainer/recorder), per-run pricing | Platform-managed; proactive re-fingerprinting | Vendor cloud |
| **goldseam** | **Existing unmodified `cy.get`-style suites** | `npm i -D goldseam` + 2 lines (or `npx goldseam init`) | **A reviewed commit/PR in your repo** | **Self-hosted/BYO** (`claude`, `cmd:`, HTTP runners planned) |

Status notes: Healenium is alive (backend updated 2026-06, AWS
Marketplace listing) but Selenium-family only — it holds the OSS
"self-healing" mindshare we're taking. mabl's two-stage healer (stored
attribute model → GenAI semantic fallback) is the commercial
sophistication bar. Nothing in the Playwright ecosystem heals existing
suites either (auto-playwright/ZeroStep/Stagehand are NL *authoring*).

## The empty quadrant

Every competitor demands at least one of: **rewrite your tests** into
their format (cy.prompt, CodeceptJS, all commercial platforms), **stand
up infrastructure** (Healenium's Docker+Postgres), **surrender the fix to
runtime magic** (all of them — no reviewed diff in your repo), or **send
your DOM to a vendor cloud you don't choose**. Nobody does: existing
suites + zero rewrite + BYO model + fix-as-reviewed-PR. That quadrant is
goldseam, and demand for it sits unanswered in the incumbents' own issue
queues (cypress#32673 BYO keys, cypress#33927 offline, cypress#20458
"heal existing scripts" → closed as "use cy.prompt").

## How we beat each

- **cy.prompt:** heal the installed base they told to rewrite; keep
  healing after "eject" (their model forfeits it); work offline/BYO.
  Their two-tier cache/AI healing defines capability parity — we match it
  and add verification rungs they don't have (rerun, oracle,
  mutation-guard).
- **Healenium:** two lines vs Docker+Postgres; Cypress (their blind
  spot); an LLM with DOM+aria evidence vs LCS similarity; a reviewed diff
  vs silent runtime substitution.
- **CodeceptJS heal:** no framework migration — we meet suites where they
  are; heals become commits, not runtime retries that vanish.
- **Commercial platforms:** no per-run pricing, no recorder, no data
  leaving the machine (air-gapped `ollama:` runner is a roadmap
  requirement, not a nice-to-have); the benchmark table
  (heal-rate by selector style) is published evidence they never show.

## The DX bar (what "simplest possible" means, measured)

Integration must stay at or under:

1. **Install:** one dependency, two wiring lines — or one command
   (`npx goldseam init`) that does the wiring itself.
2. **Zero required config.** Defaults are the product; every option is an
   escape hatch, never homework.
3. **Heal:** one command, no flags needed (`npx goldseam heal`), against
   artifacts that already exist because the plugin captured them.
4. **Review:** the output is a diff a human reads in the tool they
   already use (git/GitHub), rendering the evidence ladder — never a
   dashboard to learn.
5. **Give-up is loud and honest** — a reported verdict, not a hang or a
   guess.

Known DX debt, tracked: `goldseam heal` requires the app under test to be
reachable (same as `cypress run`); a `--start "<cmd>"` convenience flag
is the likely fix. Single-test rerun wants `@cypress/grep` registered;
without it we rerun the whole spec (correct, slower).
