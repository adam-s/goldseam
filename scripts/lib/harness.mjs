// Shared harness for the scripts/*.mjs system tests and CI jobs: one place
// for the check/finish reporting shape, demo-server lifecycle, CLI runner,
// spec template, and interrupt-safe file restore. Six scripts grew these
// independently; the drift between them was itself a bug source.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every script assumes repo-root-relative paths (demo/, .goldseam/, the
// CLI). Make that true no matter where the script is invoked from.
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));

// VS Code terminals export this; it breaks the Cypress Electron binary.
delete process.env.ELECTRON_RUN_AS_NODE;

export const CLI = 'packages/goldseam/dist/cli/index.js';

let failures = 0;

export const check = (ok, label) => {
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}`);
  if (!ok) failures++;
};

/** Print the PASSED/FAILED epilogue and exit non-zero on any failed check. */
export function finish(name) {
  if (failures > 0) {
    console.error(`\n${name} FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log(`\n${name} PASSED`);
}

async function waitForServer(url, hasDied) {
  for (let i = 0; i < 50; i++) {
    if (hasDied()) throw new Error(`server for ${url} exited before becoming ready`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server never became ready at ${url}`);
}

/** Serve `dir` on `port` and resolve only once it answers HTTP. Spawns the
 * http-server binary directly — not through `npx`, whose wrapper process
 * used to take the kill signal while the real server kept the port (the
 * documented stray-port gotcha, fixed at its cause). Returns { stop }. */
export async function startServer(dir, port) {
  const bin = join('node_modules', '.bin', 'http-server');
  const child = spawn(bin, [dir, '-p', String(port), '-c-1', '--silent'], { stdio: 'ignore' });
  let died = false;
  child.on('error', () => (died = true));
  child.on('exit', () => (died = true));
  await waitForServer(`http://127.0.0.1:${port}/`, () => died);
  return {
    stop() {
      child.kill();
    },
  };
}

/** Run the goldseam CLI synchronously; surface stderr whenever it fails so
 * a crashed CLI never debugs blind in CI. */
export function runCli(args) {
  const res = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  if (res.status !== 0 && res.stderr) process.stderr.write(res.stderr);
  return res;
}

/** The canonical breakable demo-shop spec. `selector` is the cy.get target;
 * `extra` inserts an additional line after the click; `assert: false` drops
 * the cart-count assertion (the weak-assertion / give-up legs). */
export const healableSpec = (selector, { extra = '', assert = true } = {}) =>
  `describe('healable', () => {
  it('adds a mug to the cart', () => {
    cy.visit('/');
    cy.get('${selector}', { timeout: 2000 }).click();${extra ? `\n    ${extra}` : ''}${
    assert ? `\n    cy.get('#cart-count').should('have.text', '1');` : ''
  }
  });
});
`;

/** Interrupt-safe mutation guard for scripts that edit real files (the
 * benchmark mutates the demo app; suite-bites mutates production source).
 * `try/finally` does not run on SIGINT/SIGTERM — without this, a Ctrl-C
 * mid-mutation leaves the working tree corrupted. `save(file)` snapshots
 * before the first edit; `restore()` puts everything back and clears. */
export function mutationGuard({ interruptNote = '' } = {}) {
  const saved = new Map();
  const restore = () => {
    for (const [file, content] of saved) writeFileSync(file, content);
    saved.clear();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      const count = saved.size;
      restore();
      if (count > 0) console.error(`\ninterrupted — restored ${count} mutated file(s)`);
      if (interruptNote) console.error(interruptNote);
      process.exit(130);
    });
  }
  return {
    save(file) {
      if (!saved.has(file)) saved.set(file, readFileSync(file, 'utf8'));
    },
    restore,
  };
}
