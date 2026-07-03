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

  // Transparency rule (probed, 2026-07-03): with zero 'fail' listeners a
  // test fails normally, but once ANY listener exists, Cypress only fails
  // the test if a listener throws. Users rely on non-throwing handlers to
  // swallow expected failures — so we re-throw only when we are the sole
  // listener, otherwise the user's handler keeps its exact semantics.
  const shouldRethrow = (): boolean => {
    const listeners = (Cypress as unknown as { listeners?: (e: string) => unknown[] })
      .listeners?.('fail');
    // Unknown emitter shape ⇒ fail safe: preserve the failure.
    return !listeners || listeners.length <= 1;
  };

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
      if (shouldRethrow()) throw err;
    }
  });

  // cy.* is legal again here; ship the stash to the Node side — but only
  // for the FINAL attempt. With retries on, the fail event and afterEach
  // fire per attempt (probed), and a flaky-then-green test must not leave
  // a stale capture for the healer to "fix".
  afterEach(function () {
    const test = this.currentTest;
    if (test?.state !== 'failed' || !stash) return;
    const allowed = typeof test.retries === 'function' ? test.retries() : 0;
    const attempt =
      (Cypress as unknown as { currentRetry?: number }).currentRetry ?? 0;
    if (attempt < Math.max(allowed, 0)) return; // non-final attempt: a retry is coming
    cy.task(CAPTURE_TASK, stash, { log: false });
  });
}
