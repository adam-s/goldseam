---
name: red-team-review
description: Launch an adversarial bug-hunting code reviewer (Opus) to find real bugs, correctness issues, and trust hazards in the goldseam plugin/engine — not style nits. Use when the user asks for a "red team", "bug hunt", "adversarial review", or at checkpoints after a milestone lands.
---

# Red-team adversary review

Launches an **Opus** general-purpose agent as an adversarial code reviewer
of the production code (the capture plugin, the heal engine, the CLI).

## When to invoke

- User says: "red team", "bug hunt", "adversarial review", "find what's
  broken", "find real bugs"
- A milestone from [docs/plan.md](../../../docs/plan.md) just landed
- Before publishing any release
- Proactively at checkpoints during long coding tasks

## How to invoke

Use the `Agent` tool with:

- `subagent_type: "general-purpose"`
- `model: "opus"`
- `description`: 3–5 word description (e.g. `"Red-team review post-M4"`)
- `prompt`: follow the template below

## Prompt template

Fill in the bracketed sections with real project context before invoking.
Do NOT send the template as-is.

```
You are an adversarial code reviewer performing a red-team bug hunt on
goldseam, a Cypress self-healing plugin + CLI. You find real bugs,
correctness issues, and trust hazards — NOT style nits. Rank findings by
severity (CRITICAL / HIGH / MEDIUM / LOW).

## Project

/Users/adamsohn/Projects/goldseam

npm-workspace monorepo. packages/goldseam has two worlds: a browser-side
support entry (Cypress fail-event capture, redaction, aria snapshot) and
a Node-side plugin + CLI (artifact writer; heal engine that prompts a
model, validates the proposed edit mechanically, applies it, and reruns
Cypress via the Module API). Read AGENTS.md first — "Hard rules" and
"Load-bearing invariants" define what counts as broken.

## What changed since last review (if applicable)

[Bullet list of notable changes with file:line anchors. If no prior
review, the full surface: packages/goldseam/src/{support,plugin,shared,
heal,cli} + scripts/*.mjs.]

## What to hunt

- Failure masking: any path where capture, redaction, or the fail
  handler can turn a red test green or lose the original error —
  including interactions with user fail handlers, retries, hooks,
  cy.origin, and multiple installs.
- Redaction leaks: values that escape maskText/redactedOuterHtml into
  domHtml, ariaSnapshot, errorMessage, or the URL (query strings!) —
  remember the capture is sent to a model.
- Validator bypasses: ways a model reply passes validateEdit while
  weakening an assertion or editing non-selector code — escaped quotes,
  template literals, comments, regex literals, multiple statements in
  oldString, unicode homoglyphs.
- Path/command injection: artifact JSON is attacker-influenceable
  (specPath joins into filesystem paths; cmd: runner splits on
  whitespace; prompt content comes from captured DOM — prompt injection
  steering the model's reply).
- Engine state: apply/revert races, partial writes, reruns mutating
  captures mid-heal, artifact overwrites, non-idempotent stages.
- Transparency: any observable behavior difference for a suite with
  goldseam installed vs not.

## Output format

~300–500 words. Group by severity. For each finding:
- file:line reference
- one-sentence description of the bug
- one-sentence trigger/exploit condition
Do NOT propose fixes (just the bug). End with a one-sentence risk delta
vs the previous review if one exists.

Be terse. Be specific. Find real bugs.
```

## Scripts and assets

No scripts today. Helpers, if ever needed, live in this folder only.

## Cleanup discipline

**This skill must clean up after itself.** The adversary agent is
read-only by design and should not create files.

- Temporary prompt files → delete after the agent returns.
- Scratch analysis dumps → delete unless the user asked to keep them.
- The agent's response belongs inline in the conversation; do NOT write
  it to a `.md` file in the repo unless requested.
- Final `git status` check before returning control.

Findings that are accepted rather than fixed go into AGENTS.md "Known
deferred findings" — with the reasoning, so the next agent doesn't "fix"
them.
