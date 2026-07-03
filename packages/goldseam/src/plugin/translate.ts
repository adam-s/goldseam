// Node half of `cy.goldseam(steps)`: translate English steps into the
// constrained command vocabulary via the configured runner, cache the
// result as a committable JSON file, serve cache hits with zero model
// calls.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveRunner } from '../heal/runners';
import { parseJsonBlock } from '../heal/parse';
import {
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
  ariaSnapshot: string;
}

const MAX_TRANSLATE_DOM_CHARS = 40_000;

export function buildTranslatePrompt(payload: TranslatePayload): string {
  const dom =
    payload.domHtml.length > MAX_TRANSLATE_DOM_CHARS
      ? `${payload.domHtml.slice(0, MAX_TRANSLATE_DOM_CHARS)}\n<!-- truncated -->`
      : payload.domHtml;
  return `You translate natural-language test steps into a constrained JSON command list for Cypress. You never write code — only commands from this vocabulary:

{"action":"visit","url":string}
{"action":"click"|"dblclick","selector":string,"force"?:boolean}
{"action":"type","selector":string,"text":string}
{"action":"check"|"uncheck","selector":string}
{"action":"select","selector":string,"value":string}
{"action":"trigger","selector":string,"event":string}        // mouseenter, mouseover, drag…
{"action":"scrollTo","selector"?:string,"position":string}   // "bottom", "top", "center"
{"action":"viewport","width":number,"height":number}
{"action":"assert","selector"?:string,"contains"?:string,"should":string,"value"?:string|number}
{"action":"wait","ms":number}

Rules:
- Prefer selectors in this order: data-cy > data-testid > id > role/text > css.
- \`{{name}}\` tokens in steps are placeholders — copy them through verbatim into command text; never invent their values.
- One or more commands per step, in step order. Steps saying "with a timeout of Ns" or "force click" map to the matching option.
- Reply with ONLY a JSON object: {"commands":[…]} — no prose, no fences.

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
  const parsed = parseJsonBlock(raw) as { commands?: unknown };
  const commands = validateCommands(parsed.commands);

  const entry: PromptCacheEntry = {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    steps: payload.steps,
    commands,
    model: runner.id,
    translatedAt: new Date().toISOString(),
  };
  mkdirSync(promptsDir, { recursive: true });
  const file = join(promptsDir, `${payload.key}.json`);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(entry, null, 2));
  renameSync(tmp, file);
  return entry;
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
