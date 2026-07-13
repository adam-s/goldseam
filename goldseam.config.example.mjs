// goldseam.config.mjs — optional project config, read by BOTH `goldseam`
// (heal) and `goldseam/plugin` (cy.goldseam authoring). Copy this file to
// `goldseam.config.mjs` at your project root to use it.
//
// Everything here is a DEFAULT. Precedence, most specific wins:
//   CLI flag / plugin option  >  env var  >  this file  >  built-in default
// so `goldseam heal --model claude:opus` still wins for a one-off run.
//
// Secrets never go here — keep them in the environment:
//   OPENAI_API_KEY   (openai: runner)
//   OPENAI_BASE_URL  (openai: runner, e.g. a self-hosted vLLM endpoint)
//   OLLAMA_HOST      (ollama: runner, default http://127.0.0.1:11434)

export default {
  // ── Which model, for both tools ─────────────────────────────────────
  // The runner spec: claude | claude:<model> | ollama:<model> |
  // openai:<model> | cmd:<executable>.
  model: 'claude', // → Sonnet via the Claude Code CLI (claude -p)

  // Air-gapped: a local model over Ollama, zero egress.
  // model: 'ollama:qwen2.5:14b',

  // Any OpenAI-compatible endpoint (base URL + key come from env):
  // model: 'openai:gpt-4o-mini',

  // Anything else — a script reading the prompt on stdin, JSON on stdout:
  // model: 'cmd:./my-model.sh',

  // ── Per-tool overrides (optional) ───────────────────────────────────
  // Heal with a stronger model, author with a cheaper/local one:
  // healModel: 'claude:opus',
  // promptModel: 'ollama:qwen2.5:14b',

  // ── Heal defaults (each maps to a `goldseam heal` flag) ──────────────
  // heal: {
  //   maxAttempts: 3,           // --max-attempts
  //   minConfidence: 0.5,       // --min-confidence
  //   stages: ['triage', 'propose', 'resolve', 'oracle', 'rerun-test', 'rerun-spec'],
  //   cache: true,              // false === --no-cache (disable heal memory)
  //   failuresDir: '.goldseam/failures',
  //   healsDir: '.goldseam/heals',
  //   oracleFile: '.goldseam/oracle.json',
  //   configFile: 'apps/web/cypress.config.ts', // monorepo per-app config
  // },

  // ── Author (cy.goldseam) defaults ───────────────────────────────────
  // author: {
  //   promptsDir: '.goldseam-prompts', // committable translation cache
  //   domBudget: 40000,        // char budget for the page sent to the model;
  //                            // lower it (e.g. 16000) for small-context models
  //   representation: 'dom',   // 'dom' (default) sends the raw-DOM window;
  //                            // 'aria' sends a compact accessibility outline
  //                            // whose selectors are verified unique — denser,
  //                            // better-grounded, and it dissolves the
  //                            // large-page budget cut. Falls back to 'dom'
  //                            // automatically on an un-walkable page.
  // },
};
