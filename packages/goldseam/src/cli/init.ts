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
  if (source.includes('goldseam')) return { source, changed: false };
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
  if (source.includes('goldseam')) return { source, changed: false };

  const match = source.match(SETUP_NODE_EVENTS);
  if (!match || match.index === undefined) {
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
