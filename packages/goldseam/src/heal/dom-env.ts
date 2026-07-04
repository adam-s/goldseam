// The vendored aria walk (aria-snapshot) references browser globals —
// `Node.*` constants, `Element.prototype`, `instanceof HTML*Element`. In
// the browser and under vitest's jsdom environment they exist; in the
// plain-Node CLI they don't. This shim installs one jsdom window's
// constructors onto globalThis for the duration of a single call and
// restores whatever was there before — the only place goldseam touches
// globals, and only inside the oracle's offline evaluation.

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
