// Node-side entry (`goldseam/plugin`). Registers the capture task and writes
// failure artifacts — the contract between the run and `goldseam heal`.

import { isAbsolute, join, resolve } from 'path';
import {
  CAPTURE_TASK,
  FailureCapture,
  ORACLE_TASK,
  PROMPT_LOAD_TASK,
  PROMPT_TRANSLATE_TASK,
} from '../shared/types';
import { writeCaptureArtifact } from './artifacts';
import { TranslatePayload, loadPromptCache, translateSteps } from './translate';
import { OracleRecordPayload, recordOracleEntries } from './oracle';
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
  // goldseam.config.mjs loads async (ESM), but goldseam() is synchronous, so
  // kick the load off now and await it lazily inside each task. Keep the
  // rejection: the prompt tasks re-throw it (a broken config fails LOUD, the
  // way `loadGoldseamConfig` promises), while the best-effort capture task
  // falls back to defaults so artifact writing never depends on config health.
  let configError: unknown = null;
  const configReady: Promise<GoldseamConfig> = loadGoldseamConfig(root).catch((error) => {
    configError = error;
    return {};
  });
  // Configured dirs are anchored to the project root (same monorepo reason as
  // above): a relative path in goldseam.config.mjs must not resolve against
  // Cypress's cwd, which is the config file's directory, not the repo root.
  const anchored = (dir: string) => (isAbsolute(dir) ? dir : resolve(root, dir));
  const promptsDirFor = (cfg: GoldseamConfig) =>
    anchored(options.promptsDir ?? cfg.author?.promptsDir ?? join('.goldseam-prompts'));

  on('task', {
    [CAPTURE_TASK]: async (capture: FailureCapture) => {
      // Honor the SAME failuresDir the CLI reads from (`cfg.heal.failuresDir`),
      // or captures land where `goldseam heal` never looks. Best-effort: a
      // broken config falls back to the default and never fails the run.
      const cfg = await configReady;
      const failuresDir = anchored(options.failuresDir ?? cfg.heal?.failuresDir ?? join('.goldseam', 'failures'));
      try {
        writeCaptureArtifact(failuresDir, capture);
      } catch (error) {
        console.error('[goldseam] failed to write capture artifact:', error);
      }
      return null;
    },
    [PROMPT_LOAD_TASK]: async ({ key }: { key: string }) => {
      const cfg = await configReady;
      if (configError) throw configError;
      return loadPromptCache(promptsDirFor(cfg), key);
    },
    [PROMPT_TRANSLATE_TASK]: async (payload: TranslatePayload) => {
      const cfg = await configReady;
      if (configError) throw configError;
      const promptModel = resolvePromptModel(options.promptModel, process.env, cfg);
      // The DOM budget comes from config (author.domBudget); a small-context
      // self-hosted model sets it low so the prompt fits its token window. The
      // representation (raw-DOM window vs aria outline) is likewise config-only
      // and additive — default 'dom' keeps the historical prompt unchanged.
      const withConfig = {
        ...payload,
        domBudget: payload.domBudget ?? cfg.author?.domBudget,
        representation: payload.representation ?? cfg.author?.representation,
      };
      return translateSteps(withConfig, promptModel, promptsDirFor(cfg));
    },
    [ORACLE_TASK]: (payload: OracleRecordPayload) =>
      recordOracleEntries(join(root, '.goldseam', 'oracle.json'), payload),
  });

  return config;
}

export default goldseam;
