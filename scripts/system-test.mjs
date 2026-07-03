// System test (M1 done-when): a green run stays quiet, a broken selector
// produces a schema-valid capture artifact. Serves the demo shop itself and
// drives Cypress through the Module API — the same API the heal ladder's
// rerun rungs will use.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import cypress from 'cypress';

// VS Code terminals export this; it kills the Cypress Electron binary.
delete process.env.ELECTRON_RUN_AS_NODE;

const PORT = 4173;
const FAILURES_DIR = join('.goldseam', 'failures');

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✔' : '  ✖'} ${label}`);
  if (!ok) failures++;
};

async function waitForServer(url) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`demo server never became ready at ${url}`);
}

const server = spawn('npx', ['http-server', 'demo', '-p', String(PORT), '-c-1', '--silent'], {
  stdio: 'ignore',
});

try {
  await waitForServer(`http://localhost:${PORT}/`);
  rmSync('.goldseam', { recursive: true, force: true });

  console.log('\n— green run stays quiet —');
  // Note: a completed cypress.run() result carries totals but no `status`
  // key (only failed-to-launch results have one, set to 'failed').
  const green = await cypress.run({ spec: 'cypress/e2e/smoke.cy.ts', quiet: true });
  check(green.totalFailed === 0 && green.totalPassed === 1, 'smoke spec passes');
  check(!existsSync('.goldseam'), 'no artifacts written on green');

  console.log('\n— broken selector produces a capture —');
  const red = await cypress.run({
    quiet: true,
    config: { specPattern: 'cypress/system/broken-selector.cy.ts' },
  });
  check(red.totalFailed === 1 && red.totalTests === 1, 'broken spec fails (as designed)');

  const files = existsSync(FAILURES_DIR) ? readdirSync(FAILURES_DIR) : [];
  check(files.length === 1, `exactly one artifact written (${files.length})`);

  if (files.length === 1) {
    check(/-[0-9a-f]{6}\.json$/.test(files[0]), 'filename carries the identity hash');
    const artifact = JSON.parse(readFileSync(join(FAILURES_DIR, files[0]), 'utf8'));
    check(artifact.schemaVersion === 1, 'schemaVersion is 1');
    for (const field of ['title', 'specPath', 'errorMessage', 'url', 'domHtml', 'ariaSnapshot']) {
      check(typeof artifact[field] === 'string' && artifact[field].length > 0, `${field} present`);
    }
    check(artifact.url !== 'about:blank', 'url is the loaded page, not about:blank');
    check(artifact.errorMessage.includes('does-not-exist'), 'errorMessage names the broken selector');
    check(artifact.redacted === true, 'capture is redacted');
    check(artifact.captureError === undefined, 'capture did not degrade');
  }
} finally {
  server.kill();
}

if (failures > 0) {
  console.error(`\nSYSTEM TEST FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nSYSTEM TEST PASSED');
