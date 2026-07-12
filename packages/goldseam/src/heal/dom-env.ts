// Where goldseam touches DOM machinery outside the browser: parsing
// captured HTML with jsdom, and shimming browser globals for the vendored
// aria walk (aria-snapshot references `Node.*` constants,
// `Element.prototype`, `instanceof HTML*Element` — present in the browser
// and under vitest's jsdom environment, absent in the plain-Node CLI).
// `withDomGlobals` installs one jsdom window's constructors onto globalThis
// for the duration of a single call and restores whatever was there before.

/** A jsdom window carries `close()` (stops its timers and lets the whole
 * window graph be collected). jsdom's own types are absent, so we name the
 * one method we call. */
type ParsedWindow = Record<string, unknown> & { document: Document; close?: () => void };

interface JsdomModule {
  JSDOM: new (
    html: string,
    opts?: { virtualConsole?: unknown },
  ) => { window: ParsedWindow };
  VirtualConsole: new () => unknown;
}

/** Parse captured HTML into a jsdom document + window. jsdom ships no
 * types and is loaded lazily so propose-only paths never pay for it; the
 * VirtualConsole swallows jsdom's CSS-parse and "not implemented" chatter —
 * Angular Material's @layer stylesheets flooded the CLI output on Juice
 * Shop (proving-campaign finding).
 *
 * The window is NOT self-closing: the caller owns its lifetime because some
 * consumers (the oracle rung, windowDom's anchor serialization) keep reading
 * live nodes after the initial parse. Close it — via `closeWindow` or
 * `withParsedDom` — once the LAST read is done. A jsdom window whose event
 * loop never turns (a tight synchronous parse loop, no `await` between calls)
 * is reclaimed only slowly and will OOM; closing makes `parseDom` safe to
 * call in such a loop. In the live engine a macrotask (`runner.repair`,
 * `cypress.run`) always turns the loop between heals, so this is hygiene and
 * a footgun guard, not a fix for an observed leak. */
export function parseDom(html: string): { document: Document; window: ParsedWindow } {
  const jsdom = require('jsdom') as JsdomModule;
  const { window } = new jsdom.JSDOM(html, { virtualConsole: new jsdom.VirtualConsole() });
  return { document: window.document, window };
}

/** Release a parsed window and everything it retains. Idempotent and
 * defensive: a window that never implemented `close` (or a double close) is a
 * no-op, never a throw — releasing memory must not become its own failure. */
export function closeWindow(window: ParsedWindow | undefined): void {
  try {
    window?.close?.();
  } catch {
    // A close() that throws is not worth failing a heal over.
  }
}

/** Parse `html`, run `fn` against the document, and ALWAYS close the window
 * afterward — the read-once shape (count/query, return a plain value). Do not
 * let a live node from the document escape `fn`: after this returns the window
 * is closed. For branchy flows that must keep the window open across calls,
 * hold the parse and use `closeWindow` in a `finally` instead. */
export function withParsedDom<T>(html: string, fn: (document: Document, window: ParsedWindow) => T): T {
  const { document, window } = parseDom(html);
  try {
    return fn(document, window);
  } finally {
    closeWindow(window);
  }
}

const DOM_GLOBAL_NAMES = [
  'Node',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLFormElement',
  'HTMLTemplateElement',
  'HTMLIFrameElement',
  'HTMLSlotElement',
  'HTMLDetailsElement',
  'HTMLLabelElement',
  'ShadowRoot',
  'Text',
  'NodeFilter',
  'DOMRect',
  'document',
] as const;

export function withDomGlobals<T>(window: Record<string, unknown>, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, { had: boolean; value: unknown }>();
  for (const name of DOM_GLOBAL_NAMES) {
    saved.set(name, { had: name in g, value: g[name] });
    if (window[name] !== undefined) g[name] = window[name];
  }
  try {
    return fn();
  } finally {
    for (const [name, prev] of saved) {
      if (prev.had) g[name] = prev.value;
      else delete g[name];
    }
  }
}
