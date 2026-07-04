// Node half of `cy.goldseam(steps)`: translate English steps into the
// constrained command vocabulary via the configured runner, cache the
// result as a committable JSON file, serve cache hits with zero model
// calls.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveRunner } from '../heal/runners';
import { parseJsonBlock } from '../heal/parse';
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
  ariaSnapshot: string;
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
- Prefer selectors in this order: data-cy > data-testid > id > role/text > css.
- \`{{name}}\` tokens in steps are placeholders — copy them through verbatim into command text; never invent their values.
- One or more commands per step, in step order. Steps saying "with a timeout of Ns" or "force click" map to the matching option.
- Selectors must be COPIED from the provided page HTML — verify the id/class/attribute you emit appears there verbatim. Never use a selector remembered from similar sites: if you cannot locate the step's target in the HTML, give up and say what's missing.
- Web components: to target something INSIDE a specific component's shadow root, set "shadow" to the host selector and "selector" to the element within it (e.g. {"action":"click","shadow":"sl-details","selector":"[part='header']"}). CSS cannot cross a shadow boundary with a descendant combinator.
- Ground selectors in the provided page HTML when the element is there. For expectations about elements that do NOT exist yet (an error after a failed submit, a toast, a result list), use a text assert — {"action":"assert","contains":"<expected text>","should":"be.visible"} — never a guessed container selector.
- A step must map to ONE unambiguous target. If the page offers several plausible targets and the step doesn't say which ("the checkbox" when there are three), or no plausible target exists, reply {"giveUp":{"reason":"<what was ambiguous or missing>"}} instead of guessing — a wrong guess silently tests the wrong thing.
- Reply with ONLY a JSON object: {"commands":[…]} or {"giveUp":{"reason":…}} — no prose, no fences.

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
  mkdirSync(promptsDir, { recursive: true });
  const file = join(promptsDir, `${key}.json`);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(entry, null, 2));
  renameSync(tmp, file);
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
