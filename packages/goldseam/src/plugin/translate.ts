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
import {
  InvalidTranslation,
  MAX_PROMPT_STEPS,
  PROMPT_SCHEMA_VERSION,
  PromptCacheEntry,
  validateCommands,
} from '../shared/prompt-types';

export interface TranslatePayload {
  key: string;
  steps: string[];
  url: string;
  domHtml: string;
}

const MAX_TRANSLATE_DOM_CHARS = 40_000;

/** The translator grounds selectors in markup — <head> content, scripts,
 * and inline styles are dead weight that can eat the whole budget (a
 * live Wikipedia page's head alone exceeded it, forcing a refusal on a
 * perfectly translatable step). Spend the budget on body markup. */
export function translationDom(domHtml: string): string {
  const stripped = domHtml
    .replace(/<head[\s\S]*?<\/head>/i, '<head><!-- stripped --></head>')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg><!-- stripped --></svg>');
  return stripped.length > MAX_TRANSLATE_DOM_CHARS
    ? `${stripped.slice(0, MAX_TRANSLATE_DOM_CHARS)}\n<!-- truncated -->`
    : stripped;
}

export function buildTranslatePrompt(payload: TranslatePayload): string {
  const dom = translationDom(payload.domHtml);
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
`;
}

export async function translateSteps(
  payload: TranslatePayload,
  runnerSpec: string,
  promptsDir: string,
): Promise<PromptCacheEntry> {
  if (payload.steps.length === 0 || payload.steps.length > MAX_PROMPT_STEPS) {
    throw new Error(`cy.goldseam takes 1–${MAX_PROMPT_STEPS} steps, got ${payload.steps.length}`);
  }
  const runner = resolveRunner(runnerSpec);
  const raw = await runner.repair(buildTranslatePrompt(payload));
  const parsed = parseJsonBlock(raw) as { commands?: unknown; giveUp?: { reason?: string } };
  // Vague or ambiguous steps must fail LOUD, not guess: a guessed target
  // silently tests the wrong thing. The refusal is CACHED so reruns fail
  // deterministically with zero model calls (live-site proving,
  // 2026-07-04) — same steps, same answer, no meter running.
  if (parsed.giveUp) {
    const reason = parsed.giveUp.reason ?? 'no reason given';
    persist(promptsDir, payload.key, {
      schemaVersion: PROMPT_SCHEMA_VERSION,
      steps: payload.steps,
      commands: [],
      giveUp: { reason },
      model: runner.id,
      translatedAt: new Date().toISOString(),
    });
    throw new InvalidTranslation(declineMessage(reason));
  }
  const commands = validateCommands(parsed.commands);

  const entry: PromptCacheEntry = {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    steps: payload.steps,
    commands,
    model: runner.id,
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
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PromptCacheEntry;
  } catch {
    return null; // corrupt cache regenerates
  }
}
