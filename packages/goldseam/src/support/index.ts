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

import { ariaIdentityOf, ariaSnapshot } from 'aria-snapshot';
import { CAPTURE_TASK, FailureCapture, ORACLE_TASK } from '../shared/types';
import { registerAuthoringCommand } from './authoring';
import { maskText, redactedOuterHtml, stripAriaControlValues } from './redact';
import { cloneWithShadow } from './shadow';

export interface GoldseamSupportOptions {
  /** Include the a11y-tree YAML in captures. Default true. */
  ariaSnapshot?: boolean;
  /** Truncation cap for domHtml; a `domTruncated` flag marks cut captures. Default 1 MiB. */
  maxDomBytes?: number;
  /** Strip form values and mask email/number-like text before capture. Default true. */
  redact?: boolean;
  /** Record each passing test's selector→aria-identity map into
   * .goldseam/oracle.json — the known-good manifest the oracle rung
   * verifies heals against. Opt-in: the ONE exception to "green runs
   * write nothing", and it writes only the manifest. Default false. */
  recordOracles?: boolean;
  /** Plugin-wide default for the `cy.goldseam` translation settle — a bounded
   * DOM-stability wait before the first-run capture so late SPA/AJAX content
   * is present. `false`/`0` disables; a number overrides the ~1500 ms ceiling.
   * A per-call `cy.goldseam(steps, { settle })` overrides this. Default on. */
  settle?: boolean | number;
}

let installed = false;

export function installGoldseam(userOptions: GoldseamSupportOptions = {}): void {
  // Config-file-only wiring: Cypress env `goldseam` merges under explicit
  // options (also how the E2E toggles recordOracles per run). Cypress 15's
  // `allowCypressEnv: false` makes Cypress.env() THROW — a projects-may-set
  // (and future-default) hardening we must survive: env options are
  // optional sugar, never worth failing the whole suite over.
  let envOptions: GoldseamSupportOptions = {};
  try {
    envOptions = (Cypress.env('goldseam') ?? {}) as GoldseamSupportOptions;
  } catch {
    // allowCypressEnv: false — fall back to explicit options only.
  }
  const options: GoldseamSupportOptions = { ...envOptions, ...userOptions };
  // Guard across module COPIES too (monorepo dupes/version skew): two
  // installed instances would each defer re-throwing to the other and
  // real failures would pass green (red-team finding).
  const globalFlag = Cypress as unknown as { __goldseamInstalled?: boolean };
  if (installed || globalFlag.__goldseamInstalled) return;
  installed = true;
  globalFlag.__goldseamInstalled = true;

  registerAuthoringCommand();

  const includeAria = options.ariaSnapshot ?? true;
  const maxDomBytes = options.maxDomBytes ?? 1024 * 1024;
  const redact = options.redact ?? true;

  let stash: FailureCapture | null = null;
  const recordOracles = options.recordOracles ?? false;
  // selector → identity of the element it ACTUALLY yielded, per test.
  const observed = new Map<string, { role: string; name: string }>();

  beforeEach(() => {
    stash = null;
    observed.clear();
  });

  if (recordOracles) {
    Cypress.on('command:end', (cmd: unknown) => {
      try {
        const c = cmd as { attributes?: { name?: string; args?: unknown[] }; get?: (k: string) => unknown };
        if (c.attributes?.name !== 'get') return;
        const selector = c.attributes.args?.[0];
        if (typeof selector !== 'string') return;
        const subject = c.get?.('subject') as ArrayLike<Element> | undefined;
        const el = subject?.[0];
        if (!el || el.nodeType !== 1) return;
        const identity = ariaIdentityOf(el);
        if (identity) observed.set(selector, identity);
      } catch {
        // recording is best-effort; it must never disturb a run
      }
    });
  }

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
      // Error text embeds element text and asserted values — mask it like
      // everything else the model sees (red-team finding).
      errorMessage: redact ? maskText(err.message) : err.message,
      url: '',
      domHtml: '',
      ariaSnapshot: '',
      redacted: redact,
    };
    try {
      const doc = Cypress.$('html')[0].ownerDocument;
      stash.url = redact ? maskText(doc.location.href) : doc.location.href;
      // Under cy.origin the AUT frame is cross-origin and jQuery resolves
      // to the Cypress runner document instead (path /__/). Capturing the
      // runner UI as "the app" is misleading evidence a model would heal
      // against — degrade honestly instead (probed 2026-07-03).
      if (doc.location.pathname.startsWith('/__')) {
        stash.captureError =
          'AUT document unreachable — got the Cypress runner instead (cross-origin failure under cy.origin?)';
      } else {
        const domHtml = redact
          ? redactedOuterHtml(doc.documentElement)
          : cloneWithShadow(doc.documentElement).outerHTML;
        if (domHtml.length > maxDomBytes) {
          stash.domHtml = domHtml.slice(0, maxDomBytes);
          stash.domTruncated = true;
        } else {
          stash.domHtml = domHtml;
        }
        if (includeAria) {
          // frames: same-origin iframe content nests under its iframe node
          // (cross-origin frames stay opaque leaves), matching the DOM
          // capture's <template data-frame-content> inlining.
          const aria = ariaSnapshot(doc.body, { frames: true });
          // Strip text-control VALUES before pattern-masking: the aria tree
          // renders a typed value inline (`textbox "Pw": <value>`), which
          // maskText alone would not remove — the DOM clone strips these, the
          // aria path must too, or passwords/PII leak to the model.
          stash.ariaSnapshot = redact ? maskText(stripAriaControlValues(aria)) : aria;
        }
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
    const allowed = typeof test?.retries === 'function' ? test.retries() : 0;
    const attempt =
      (Cypress as unknown as { currentRetry?: number }).currentRetry ?? 0;
    const finalAttempt = attempt >= Math.max(allowed, 0);
    if (recordOracles && test?.state === 'passed' && observed.size > 0) {
      cy.task(
        ORACLE_TASK,
        {
          specPath: Cypress.spec.relative,
          title: test.fullTitle(),
          entries: [...observed.entries()].map(([selector, id]) => ({ selector, ...id })),
        },
        { log: false },
      );
    }
    if (test?.state !== 'failed' || !stash) return;
    if (!finalAttempt) return; // non-final attempt: a retry is coming
    cy.task(CAPTURE_TASK, stash, { log: false });
  });
}
