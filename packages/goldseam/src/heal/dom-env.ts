// Where goldseam touches DOM machinery outside the browser: parsing
// captured HTML with jsdom, and shimming browser globals for the vendored
// aria walk (aria-snapshot references `Node.*` constants,
// `Element.prototype`, `instanceof HTML*Element` — present in the browser
// and under vitest's jsdom environment, absent in the plain-Node CLI).
// `withDomGlobals` installs one jsdom window's constructors onto globalThis
// for the duration of a single call and restores whatever was there before.

interface JsdomModule {
  JSDOM: new (
    html: string,
    opts?: { virtualConsole?: unknown },
  ) => { window: Record<string, unknown> & { document: Document } };
  VirtualConsole: new () => unknown;
}

/** Parse captured HTML into a jsdom document + window. jsdom ships no
 * types and is loaded lazily so propose-only paths never pay for it; the
 * VirtualConsole swallows jsdom's CSS-parse and "not implemented" chatter —
 * Angular Material's @layer stylesheets flooded the CLI output on Juice
 * Shop (proving-campaign finding). */
export function parseDom(html: string): {
  document: Document;
  window: Record<string, unknown> & { document: Document };
} {
  const jsdom = require('jsdom') as JsdomModule;
  const { window } = new jsdom.JSDOM(html, { virtualConsole: new jsdom.VirtualConsole() });
  return { document: window.document, window };
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
