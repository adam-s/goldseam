// Bounded DOM-stability settle for the authoring translation capture.
//
// The constraint: `cy.goldseam` grounds its ONE translation on the live DOM.
// On a static page that DOM is ready at `domcontentloaded`, but SPA/AJAX pages
// paint the target AFTER load — so a capture taken the instant the command runs
// sees stale markup, and the model refuses or grounds on the wrong page.
//
// The naive fix — a fixed `cy.wait(ms)` — is either too short (misses slow
// content) or too slow (pauses every static page). Instead, watch the DOM and
// capture once it stops changing: a MutationObserver resolves the settle after
// `quietMs` of no mutations, bounded by a hard `maxMs` ceiling so a page that
// never quiesces (animations, polling) can't stall the run.
//
// Transparency (load-bearing): this runs INSIDE the `cy.goldseam` command the
// author explicitly wrote — never the general suite, never the cache-hit
// replay. It touches no global listeners, fully disconnects its observer on
// resolve, and NEVER throws: any failure degrades to capturing immediately.

/** Default quiescent window — capture once the DOM has been still this long. */
export const SETTLE_QUIET_MS = 200;
/** Default hard ceiling — never wait longer than this before capturing. */
export const SETTLE_MAX_MS = 1500;

export interface SettleBounds {
  /** Capture after the DOM has been mutation-free for this many ms. */
  quietMs: number;
  /** Hard cap: capture no later than this, quiet or not. */
  maxMs: number;
}

/**
 * Resolve the settle knob (`settle` on the per-call or env options) to a
 * millisecond cap. `false` or `0` disables the settle entirely; a positive
 * number overrides the default ceiling; `true`/`undefined` uses the default.
 */
export function resolveSettleMs(settle: boolean | number | undefined): number {
  if (settle === false) return 0;
  if (typeof settle === 'number') return settle > 0 ? settle : 0;
  return SETTLE_MAX_MS; // true or undefined
}

/**
 * Resolve once the DOM under `root` has been mutation-free for `quietMs`, or
 * `maxMs` has elapsed — whichever comes first. Always resolves, never rejects:
 * if MutationObserver is unavailable or setup throws, it resolves immediately
 * so the caller captures without delay.
 */
export function waitForDomStable(root: Node, { quietMs, maxMs }: SettleBounds): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const view = (root.ownerDocument ?? (root as unknown as Document))?.defaultView;
      const MO =
        view?.MutationObserver ??
        (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
      if (!MO) {
        resolve();
        return;
      }

      let quietTimer: ReturnType<typeof setTimeout> | undefined;
      let capTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (quietTimer) clearTimeout(quietTimer);
        if (capTimer) clearTimeout(capTimer);
        observer.disconnect(); // fully release the observer — no leak
        resolve();
      };

      const observer = new MO(() => {
        // Each mutation restarts the quiet window; the cap timer is untouched.
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });

      quietTimer = setTimeout(finish, quietMs);
      capTimer = setTimeout(finish, maxMs);
    } catch {
      // A settle failure must never fail the author's test — capture now.
      resolve();
    }
  });
}
