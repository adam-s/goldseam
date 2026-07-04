// The artifact schema is a public API: the contract between the test run,
// the CLI, and the repair model. Version it in the file; additive changes
// bump minor, breaking changes bump the package major.

export const FAILURE_SCHEMA_VERSION = 1;

/** Payload stashed in the browser on `fail` and shipped over cy.task. */
export interface FailureCapture {
  title: string;
  specPath: string;
  errorMessage: string;
  /** 'about:blank' is a first-class give-up signal: the visit never loaded. */
  url: string;
  domHtml: string;
  /** Playwright-format a11y YAML; empty string when disabled. */
  ariaSnapshot: string;
  /** Present only when capture itself degraded (best-effort, never masks the test error). */
  captureError?: string;
  /** Present when domHtml was cut at maxDomBytes. */
  domTruncated?: true;
  /** False only when the consumer opted out of redaction. */
  redacted: boolean;
}

/** What lands on disk in `.goldseam/failures/<slug>-<hash6>.json`. */
export interface FailureArtifact extends FailureCapture {
  schemaVersion: number;
  /** Parsed from errorMessage when derivable; absent otherwise. */
  failedSelector?: string;
}

/** The browser→Node bridge; namespaced to stay composable with other plugins' tasks. */
export const CAPTURE_TASK = 'goldseam:capture';

/** Green-run oracle harvest (opt-in `recordOracles`): the ONE sanctioned
 * exception to "green runs write nothing" — it writes only the
 * known-good identity manifest, never captures. */
export const ORACLE_TASK = 'goldseam:oracle:record';
