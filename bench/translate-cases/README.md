# Translation eval — can English become accurate test steps?

The measured answer to "if a developer points `cy.goldseam` at THEIR
project, do plain-English steps translate into accurate commands?"
Each case is a realistic DOM fixture + steps + a deterministic
expectation; the grader never uses an LLM:

- an emitted selector must resolve, uniquely enough, to the INTENDED
  element (the expectation names it with its own canonical selector —
  fixtures carry no oracle attributes the model could parrot);
- action sequences must match; typed/asserted text must carry the
  expected content; unseen-element expectations must be text asserts;
- `refuse` cases MUST produce a give-up — a confident guess scores zero.

Run: `node bench/translate-eval.mjs [--model claude:sonnet]` — real model
calls; local-only, never CI. Results in `bench/translate-results.json`;
compare against `bench/translate-baseline.json` before trusting a prompt
change.

Case layout: `<name>/dom.html`, `<name>/case.json`
({steps, url?, expect: {refuse: true} | {commands: [{action, target?,
textIncludes?, containsIncludes?, shadowHost?}]}}) — `target` is the
grader's canonical selector for the intended element; extra trailing
asserts emitted by the model are tolerated, wrong targets are not.
