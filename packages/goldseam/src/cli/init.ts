// `goldseam init` — wire a Cypress project in one command. The rewriters
// are pure string transforms so the wiring rules are unit-testable; the
// command is a thin fs wrapper around them. Conservative by design: when
// a config isn't confidently rewritable, print the exact snippet instead
// of guessing at someone's file.

export interface WireResult {
  source: string;
  changed: boolean;
  /** Set when the file couldn't be rewritten confidently. */
  instructions?: string;
}

const usesRequire = (source: string) => /\brequire\s*\(/.test(source) && !/^\s*import\s/m.test(source);

export const SUPPORT_SNIPPET = `import 'goldseam/support/register';`;
const SUPPORT_SNIPPET_CJS = `require('goldseam/support/register');`;

export function wireSupportSource(source: string): WireResult {
  // Wired means the support entry is actually referenced — a stray
  // "goldseam" elsewhere (a comment, a cy.goldseam call) doesn't count.
  if (source.includes('goldseam/support')) return { source, changed: false };
  const line = usesRequire(source) ? SUPPORT_SNIPPET_CJS : SUPPORT_SNIPPET;
  return { source: `${line}\n${source.length > 0 ? '\n' : ''}${source}`, changed: true };
}

export const CONFIG_SNIPPET = `import goldseam from 'goldseam/plugin';

// inside e2e (or component):
//   setupNodeEvents(on, config) {
//     return goldseam(on, config);
//   },`;

// Matches `setupNodeEvents(on, config) {`, `async setupNodeEvents(on, config) {`,
// `setupNodeEvents: (on, config) => {`, and function-expression forms.
const SETUP_NODE_EVENTS =
  /setupNodeEvents\s*:?\s*(?:async\s+)?(?:function\s*)?\(\s*([\w$]+)\s*,\s*([\w$]+)[^)]*\)\s*(?::\s*[\w<>., |[\]]+\s*)?(?:=>)?\s*\{/;

export function wireConfigSource(source: string): WireResult {
  // "Already wired" requires the real shape: the plugin import AND a
  // goldseam(...) call. A file that merely mentions goldseam (a wrong
  // import name, a commented-out call) must NOT be endorsed as wired —
  // print the snippet instead, per the conservative design above.
  if (source.includes('goldseam/plugin') && /\bgoldseam\s*\(/.test(source)) {
    return { source, changed: false };
  }
  if (source.includes('goldseam')) {
    return { source, changed: false, instructions: CONFIG_SNIPPET };
  }

  const match = source.match(SETUP_NODE_EVENTS);
  if (!match || match.index === undefined) {
    // No setupNodeEvents — the MOST common consumer shape
    // (`defineConfig({ e2e: { baseUrl } })`). Insert a whole block into
    // `e2e: {` rather than telling the user to paste one (fresh-consumer
    // walkthrough: this was the one manual step in the two-line story).
    const e2e = source.match(/\be2e\s*:\s*\{/);
    if (e2e && e2e.index !== undefined) {
      const insertAt = e2e.index + e2e[0].length;
      const body = `\n    setupNodeEvents(on, config) {\n      return goldseam(on, config);\n    },`;
      const importLine = usesRequire(source)
        ? `const { goldseam } = require('goldseam/plugin');\n`
        : `import goldseam from 'goldseam/plugin';\n`;
      const importBlock = source.match(/^(?:(?:import\s[^\n]*|const\s[^\n]*=\s*require\([^\n]*)\n)+/);
      const importAt = importBlock ? importBlock[0].length : 0;
      return {
        source:
          source.slice(0, importAt) + importLine + source.slice(importAt, insertAt) + body + source.slice(insertAt),
        changed: true,
      };
    }
    return { source, changed: false, instructions: CONFIG_SNIPPET };
  }
  const [full, onParam, configParam] = match;
  const insertAt = match.index + full.length;
  const indent = '      ';
  const body = `\n${indent}${'goldseam'}(${onParam}, ${configParam});`;

  const importLine = usesRequire(source)
    ? `const { goldseam } = require('goldseam/plugin');\n`
    : `import goldseam from 'goldseam/plugin';\n`;

  // Import goes after the last existing top-of-file import/require line,
  // or at the very top when there are none. Both positions were measured
  // on the original source, and importAt <= insertAt always (imports
  // precede setupNodeEvents), so slicing in order keeps them consistent.
  const importBlock = source.match(/^(?:(?:import\s[^\n]*|const\s[^\n]*=\s*require\([^\n]*)\n)+/);
  const importAt = importBlock ? importBlock[0].length : 0;

  return {
    source:
      source.slice(0, importAt) +
      importLine +
      source.slice(importAt, insertAt) +
      body +
      source.slice(insertAt),
    changed: true,
  };
}
