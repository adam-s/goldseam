// Node-side entry (`goldseam/plugin`). Registers the capture task and writes
// failure artifacts — the contract between the run and `goldseam heal`.

import { join } from 'path';
import { CAPTURE_TASK, FailureCapture } from '../shared/types';
import { writeCaptureArtifact } from './artifacts';
import { TranslatePayload, loadPromptCache, translateSteps } from './translate';
import { OracleRecordPayload, recordOracleEntries } from './oracle';
import { ORACLE_TASK } from '../shared/types';
import { GoldseamConfig, loadGoldseamConfig, resolvePromptModel } from '../shared/config';

export interface GoldseamPluginOptions {
  /** Where failure artifacts land. Default `.goldseam/failures`. */
  failuresDir?: string;
  /** Committable translation cache for cy.goldseam(). Default `.goldseam-prompts`. */
  promptsDir?: string;
  /** Runner for first-run step translation. Default `claude` (Sonnet). */
  promptModel?: string;
}

/** Node-side install. Returns `config` so `setupNodeEvents` can be one line. */
export function goldseam(
  on: Cypress.PluginEvents,
  config: Cypress.PluginConfigOptions,
  options: GoldseamPluginOptions = {},
): Cypress.PluginConfigOptions {
  // Anchor artifacts to the PROJECT ROOT, not process.cwd(): Cypress runs
  // setupNodeEvents with cwd set to the config file's directory, so a
  // per-app config (common in monorepos — and how PrairieLearn is wired)
  // would otherwise scatter .goldseam/ next to the config where
  // `goldseam heal` (run from the repo root) can't find it. Surfaced by
  // the PrairieLearn proving ground, 2026-07-03.
  const root = config.projectRoot ?? process.cwd();
  // goldseam.config.mjs loads async (ESM), but goldseam() is synchronous —
  // so kick the load off now and await it lazily inside the translate task
  // (itself async). A broken config surfaces there, not by failing setup.
  const configReady: Promise<GoldseamConfig> = loadGoldseamConfig(root).catch((error) => {
    console.error(`[goldseam] ${error instanceof Error ? error.message : error}`);
    return {};
  });
  const failuresDir = options.failuresDir ?? join(root, '.goldseam', 'failures');

  on('task', {
    [CAPTURE_TASK]: (capture: FailureCapture) => {
      // Best-effort: an artifact-write failure must never fail the run.
      try {
        writeCaptureArtifact(failuresDir, capture);
      } catch (error) {
        console.error('[goldseam] failed to write capture artifact:', error);
      }
      return null;
    },
    'goldseam:prompt:load': async ({ key }: { key: string }) => {
      const cfg = await configReady;
      const promptsDir = options.promptsDir ?? cfg.author?.promptsDir ?? join(root, '.goldseam-prompts');
      return loadPromptCache(promptsDir, key);
    },
    'goldseam:prompt:translate': async (payload: TranslatePayload) => {
      const cfg = await configReady;
      const promptsDir = options.promptsDir ?? cfg.author?.promptsDir ?? join(root, '.goldseam-prompts');
      const promptModel = resolvePromptModel(options.promptModel, process.env, cfg);
      return translateSteps(payload, promptModel, promptsDir);
    },
    [ORACLE_TASK]: (payload: OracleRecordPayload) =>
      recordOracleEntries(join(root, '.goldseam', 'oracle.json'), payload),
  });

  return config;
}

export default goldseam;
