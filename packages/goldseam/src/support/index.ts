// Browser-side entry (`goldseam/support`). Everything the healer needs from
// inside the run hooks in here, so target projects adopt it with a single
// import + call in their support file.
//
// Invariants (tested, non-negotiable):
// - No cy.* commands inside the `fail` handler; stash synchronously.
// - The handler re-throws in `finally` so a capture failure can never mask
//   (or worse, green-light) the real test failure.
// - Captures are best-effort and quiet on green runs.
// - The captured DOM is redacted by default; the model never needs field
//   values to fix a selector.

import { ariaSnapshot } from '@goldseam/aria-snapshot';
import { CAPTURE_TASK, FailureCapture } from '../shared/types';
import { maskText, redactedOuterHtml } from './redact';

export interface GoldseamSupportOptions {
  /** Include the a11y-tree YAML in captures. Default true. */
  ariaSnapshot?: boolean;
  /** Truncation cap for domHtml; a `domTruncated` flag marks cut captures. Default 1 MiB. */
  maxDomBytes?: number;
  /** Strip form values and mask email/number-like text before capture. Default true. */
  redact?: boolean;
}

let installed = false;

export function installGoldseam(options: GoldseamSupportOptions = {}): void {
  if (installed) return;
  installed = true;

  const includeAria = options.ariaSnapshot ?? true;
  const maxDomBytes = options.maxDomBytes ?? 1024 * 1024;
  const redact = options.redact ?? true;

  let stash: FailureCapture | null = null;

  beforeEach(() => {
    stash = null;
  });

  Cypress.on('fail', (err, runnable) => {
    stash = {
      title: runnable.fullTitle(),
      specPath: Cypress.spec.relative,
      errorMessage: err.message,
      url: '',
      domHtml: '',
      ariaSnapshot: '',
      redacted: redact,
    };
    try {
      const doc = Cypress.$('html')[0].ownerDocument;
      stash.url = doc.location.href;
      const domHtml = redact
        ? redactedOuterHtml(doc.documentElement)
        : doc.documentElement.outerHTML;
      if (domHtml.length > maxDomBytes) {
        stash.domHtml = domHtml.slice(0, maxDomBytes);
        stash.domTruncated = true;
      } else {
        stash.domHtml = domHtml;
      }
      if (includeAria) {
        const aria = ariaSnapshot(doc.body);
        stash.ariaSnapshot = redact ? maskText(aria) : aria;
      }
    } catch (error) {
      stash.captureError = error instanceof Error ? error.message : String(error);
    } finally {
      throw err;
    }
  });

  // cy.* is legal again here; ship the stash to the Node side.
  afterEach(function () {
    if (this.currentTest?.state === 'failed' && stash) {
      cy.task(CAPTURE_TASK, stash, { log: false });
    }
  });
}
