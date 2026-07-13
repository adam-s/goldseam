// Node half of `cy.goldseam(steps)`: translate English steps into the
// constrained command vocabulary via the configured runner, cache the
// result as a committable JSON file, serve cache hits with zero model
// calls.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveRunner } from '../heal/runners';
import { parseJsonBlock } from '../heal/parse';
import { writeJsonAtomic } from '../shared/fs';
import { TRANSLATE_RULES } from './translate-rules';
import { stepAnchors, windowTranslationDom } from './translate-window';
import {
  rederiveUnresolved,
  UnresolvedSelector,
  verifyCommands,
  verifyFeedback,
} from './translate-verify';
import {
  InvalidTranslation,
  MAX_PROMPT_STEPS,
  PROMPT_SCHEMA_VERSION,
  PromptCacheEntry,
  StepCommand,
  validateCommands,
} from '../shared/prompt-types';

export interface TranslatePayload {
  key: string;
  steps: string[];
  url: string;
  domHtml: string;
  /** Char budget for the DOM embedded in the prompt; default 40000. Lower it
   * (e.g. 16000) for small-context self-hosted models. */
  domBudget?: number;
}

/** Default DOM budget. A small-context self-hosted model (e.g. an 8K-token
 * vLLM serve) must request a smaller one; frontier models keep this. */
export const DEFAULT_TRANSLATE_DOM_BUDGET = 40_000;

/** The translator grounds selectors in markup — <head> content, scripts,
 * and inline styles are dead weight that can eat the whole budget (a
 * live Wikipedia page's head alone exceeded it, forcing a refusal on a
 * perfectly translatable step). Spend the budget on body markup — and when
 * the body still overflows, a step-anchored window keeps the element a step
 * names in view instead of a blind head-first cut that drops it (the
 * authoring twin of the heal path; see translate-window.ts). */
export function translationDom(
  domHtml: string,
  opts: { budget?: number; steps?: string[] } = {},
): string {
  const budget = opts.budget ?? DEFAULT_TRANSLATE_DOM_BUDGET;
  const stripped = domHtml
    .replace(/<head[\s\S]*?<\/head>/i, '<head><!-- stripped --></head>')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg><!-- stripped --></svg>');
  if (stripped.length <= budget) return stripped;
  // Over budget: window around a step anchor, else head-first (never throws).
  return windowTranslationDom(stripped, stepAnchors(opts.steps ?? []), budget);
}

export function buildTranslatePrompt(payload: TranslatePayload, feedback?: string): string {
  const dom = translationDom(payload.domHtml, { budget: payload.domBudget, steps: payload.steps });
  const correction = feedback ? `\n## Correction (your last answer was rejected)\n${feedback}\n` : '';
  return `You translate natural-language test steps into a constrained JSON command list for Cypress. You never write code — only commands from this vocabulary:

{"action":"visit","url":string}
{"action":"click"|"dblclick","selector":string,"force"?:boolean,"shadow"?:string}
{"action":"type","selector":string,"text":string,"shadow"?:string}
{"action":"check"|"uncheck","selector":string}
{"action":"select","selector":string,"value":string}
{"action":"trigger","selector":string,"event":string}        // mouseenter, mouseover, drag…
{"action":"scrollTo","selector"?:string,"position":string}   // "bottom", "top", "center"
{"action":"viewport","width":number,"height":number}
{"action":"assert","selector"?:string,"contains"?:string,"should":string,"value"?:string|number}
{"action":"wait","ms":number}

Rules:
${TRANSLATE_RULES}

## Steps
${payload.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Current page (may predate a visit step)
URL: ${payload.url}
\`\`\`html
${dom || '(blank — rely on the steps and common patterns)'}
\`\`\`
${correction}`;
}

/** Extra model calls the verify pass may spend when a selector hallucinates —
 * on top of the first attempt. Kept small: a model that hallucinates twice
 * running after being shown the page HTML and told to copy a selector is not
 * going to converge, and each extra call costs money/latency. */
export const MAX_VERIFY_RETRIES = 2;

export async function translateSteps(
  payload: TranslatePayload,
  runnerSpec: string,
  promptsDir: string,
): Promise<PromptCacheEntry> {
  if (payload.steps.length === 0 || payload.steps.length > MAX_PROMPT_STEPS) {
    throw new Error(`cy.goldseam takes 1–${MAX_PROMPT_STEPS} steps, got ${payload.steps.length}`);
  }
  const runner = resolveRunner(runnerSpec);
  const giveUp = (reason: string): never => {
    // Vague/ambiguous steps — and unfixable hallucinated selectors — must fail
    // LOUD, not guess: a guessed target silently tests the wrong thing. The
    // refusal is CACHED so reruns fail deterministically with zero model calls
    // (live-site proving, 2026-07-04) — same steps, same answer, no meter
    // running.
    persist(promptsDir, payload.key, {
      schemaVersion: PROMPT_SCHEMA_VERSION,
      steps: payload.steps,
      commands: [],
      giveUp: { reason },
      model: runner.id,
      translatedAt: new Date().toISOString(),
    });
    throw new InvalidTranslation(declineMessage(reason));
  };

  let feedback: string | undefined;
  let lastUnresolved: UnresolvedSelector[] = [];
  // Attempt 0 is the normal translation; attempts 1..MAX_VERIFY_RETRIES are
  // retranslations, each shown which selector matched nothing.
  for (let attempt = 0; attempt <= MAX_VERIFY_RETRIES; attempt++) {
    const raw = await runner.repair(buildTranslatePrompt(payload, feedback));
    const parsed = parseJsonBlock(raw) as { commands?: unknown; giveUp?: { reason?: string } };
    // The model's OWN refusal ends the loop at any attempt.
    if (parsed.giveUp) giveUp(parsed.giveUp.reason ?? 'no reason given');
    const commands = validateCommands(parsed.commands);

    // VERIFY: every action selector must resolve in the DOM the model saw.
    // Authoring has no rerun rung, so a non-resolving selector is caught here
    // or never — it is never shipped.
    const unresolved = verifyCommands(commands, payload.domHtml);
    if (unresolved.length === 0) return finalize(promptsDir, payload, commands, runner.id);

    // GUARDED RE-DERIVE (last resort, unambiguous only): when a single
    // explicit target text resolves to exactly one element, re-derive that
    // element's selector rather than spend another model call.
    const rederived = rederiveUnresolved(commands, unresolved, payload.steps, payload.domHtml);
    if (rederived.remaining.length === 0) {
      return finalize(promptsDir, payload, rederived.commands, runner.id);
    }

    lastUnresolved = rederived.remaining;
    feedback = verifyFeedback(rederived.remaining);
  }

  // Exhausted the retry budget with a still-hallucinating selector — give up
  // rather than ship a selector that points at nothing.
  const names = lastUnresolved.map((u) => `\`${u.selector}\``).join(', ');
  return giveUp(
    `the model kept proposing selector(s) that match nothing in the captured page HTML (${names}) after ${MAX_VERIFY_RETRIES + 1} attempts`,
  );
}

function finalize(
  promptsDir: string,
  payload: TranslatePayload,
  commands: StepCommand[],
  model: string,
): PromptCacheEntry {
  const entry: PromptCacheEntry = {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    steps: payload.steps,
    commands,
    model,
    translatedAt: new Date().toISOString(),
  };
  persist(promptsDir, payload.key, entry);
  return entry;
}

export const declineMessage = (reason: string): string =>
  `the model declined to translate: ${reason} — make the step specific enough to name one target`;

function persist(promptsDir: string, key: string, entry: PromptCacheEntry): void {
  writeJsonAtomic(join(promptsDir, `${key}.json`), entry);
}

export function loadPromptCache(promptsDir: string, key: string): PromptCacheEntry | null {
  const file = join(promptsDir, `${key}.json`);
  if (!existsSync(file)) return null;
  let entry: PromptCacheEntry;
  try {
    entry = JSON.parse(readFileSync(file, 'utf8')) as PromptCacheEntry;
  } catch {
    return null; // corrupt cache regenerates
  }
  // The prompt-cache schema is a public API like the capture/heal artifacts;
  // `persist` stamps `schemaVersion` but nothing validated it on load, so an
  // entry from a future breaking bump (or a hand-edited/foreign committed file)
  // would replay with mismatched command semantics — silently wrong. Mirror the
  // heal engine: a version mismatch means "don't trust this entry" → retranslate.
  if (Math.floor(entry?.schemaVersion as number) !== PROMPT_SCHEMA_VERSION) return null;
  return entry;
}
