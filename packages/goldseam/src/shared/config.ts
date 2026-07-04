// Optional project config: `goldseam.config.mjs` at the project root, read
// by BOTH the `goldseam` CLI (heal) and the `goldseam/plugin` (author), so
// the model and its defaults live in ONE committed, reviewable place
// instead of split across a CLI flag and a plugin option.
//
// `.mjs` on purpose: the standalone CLI is a plain (CommonJS) Node process,
// so it can't `require()` an ESM config and won't pull in a TS loader for a
// `.ts` one — but it CAN `await import()` a `.mjs` from either module
// system, and `.mjs` is unambiguously ESM regardless of the host project's
// `"type"`. Secrets never belong here (they stay in env: OPENAI_API_KEY,
// OLLAMA_HOST, …); this file holds the model spec and non-secret defaults.
//
// Precedence, most specific wins: explicit CLI flag / plugin option  >
// environment variable  >  goldseam.config.mjs  >  built-in default.

import { existsSync } from 'fs';
import { isAbsolute, join } from 'path';
import { pathToFileURL } from 'url';

/** The built-in model when nothing else selects one. */
export const DEFAULT_MODEL = 'claude';

export const CONFIG_FILENAME = 'goldseam.config.mjs';

/** Heal-only knobs; each maps to a `goldseam heal` flag / `HealOptions`
 * field and is overridden by that flag when both are present. */
export interface GoldseamHealConfig {
  maxAttempts?: number;
  minConfidence?: number;
  stages?: string[];
  failuresDir?: string;
  healsDir?: string;
  oracleFile?: string | null;
  /** `false` disables heal memory (same as `--no-cache`). */
  cache?: boolean;
  /** Cypress config for the rerun rungs (monorepo per-app configs). */
  configFile?: string;
}

/** Author-only (`cy.goldseam`) knobs. */
export interface GoldseamAuthorConfig {
  promptsDir?: string;
}

/** The shape a `goldseam.config.mjs` may `export default`. Every field is
 * optional — an empty object (or no file at all) is valid and means
 * "defaults everywhere". */
export interface GoldseamConfig {
  /** Runner spec for both tools unless a per-tool override is set. */
  model?: string;
  /** Override the model for `goldseam heal` only. */
  healModel?: string;
  /** Override the model for `cy.goldseam()` translation only. */
  promptModel?: string;
  heal?: GoldseamHealConfig;
  author?: GoldseamAuthorConfig;
}

/** First value that is neither `undefined` nor `null`; `undefined` if none.
 * The precedence primitive — callers pass sources most-specific first. */
export function firstDefined<T>(...values: (T | undefined | null)[]): T | undefined {
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

/** Resolve the heal model: `--model` flag > `GOLDSEAM_MODEL` env >
 * `healModel` > `model` > built-in default. */
export function resolveHealModel(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  config: GoldseamConfig,
): string {
  return firstDefined(flag, env.GOLDSEAM_MODEL, config.healModel, config.model, DEFAULT_MODEL)!;
}

/** Resolve the author (translation) model: plugin `promptModel` option >
 * `GOLDSEAM_PROMPT_MODEL` env > `GOLDSEAM_MODEL` env > `promptModel` >
 * `model` > built-in default. The per-tool env var (`GOLDSEAM_PROMPT_MODEL`)
 * stays supported and outranks the shared one for back-compat. */
export function resolvePromptModel(
  option: string | undefined,
  env: NodeJS.ProcessEnv,
  config: GoldseamConfig,
): string {
  return firstDefined(
    option,
    env.GOLDSEAM_PROMPT_MODEL,
    env.GOLDSEAM_MODEL,
    config.promptModel,
    config.model,
    DEFAULT_MODEL,
  )!;
}

/** Load `goldseam.config.mjs` from `dir` (the project root). Returns `{}`
 * when the file is absent — the common case, never an error. Throws a
 * framed error when the file EXISTS but fails to import or exports a
 * non-object, so a broken config is loud, never silently ignored. */
export async function loadGoldseamConfig(dir: string): Promise<GoldseamConfig> {
  const base = isAbsolute(dir) ? dir : join(process.cwd(), dir);
  const file = join(base, CONFIG_FILENAME);
  if (!existsSync(file)) return {};

  let mod: { default?: unknown };
  try {
    // Dynamic import: works from CommonJS, loads the ESM `.mjs`, and is
    // preserved (not down-levelled to require) under module: node16.
    mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  } catch (error) {
    throw new Error(
      `goldseam: ${CONFIG_FILENAME} failed to load: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const value = mod.default ?? mod;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`goldseam: ${CONFIG_FILENAME} must \`export default\` an object`);
  }
  return value as GoldseamConfig;
}
