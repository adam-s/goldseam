// Node-side entry (`goldseam/plugin`). Registers the capture task and writes
// failure artifacts — the contract between the run and `goldseam heal`.

import { join } from 'path';
import { CAPTURE_TASK, FailureCapture } from '../shared/types';
import { writeCaptureArtifact } from './artifacts';

export interface GoldseamPluginOptions {
  /** Where failure artifacts land. Default `.goldseam/failures`. */
  failuresDir?: string;
}

/** Node-side install. Returns `config` so `setupNodeEvents` can be one line. */
export function goldseam(
  on: Cypress.PluginEvents,
  config: Cypress.PluginConfigOptions,
  options: GoldseamPluginOptions = {},
): Cypress.PluginConfigOptions {
  const failuresDir = options.failuresDir ?? join('.goldseam', 'failures');

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
  });

  return config;
}

export default goldseam;
