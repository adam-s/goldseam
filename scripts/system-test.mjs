// System test: a green run stays quiet, a broken selector
// produces a schema-valid capture artifact. Serves the demo shop itself and
// drives Cypress through the Module API — the same API the heal ladder's
// rerun rungs will use.

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import cypress from 'cypress';
import { check, finish, startServer } from './lib/harness.mjs';

const FAILURES_DIR = join('.goldseam', 'failures');

const server = await startServer('demo', 4173);

try {
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
    check(artifact.failedSelector === '[data-cy="does-not-exist"]', 'failedSelector parsed from the error');
    check(
      artifact.domHtml.includes('<template shadowrootmode="open">') &&
        artifact.domHtml.includes('Ping support'),
      'capture pierces open shadow roots',
    );
    check(artifact.errorMessage.includes('does-not-exist'), 'errorMessage names the broken selector');
    check(artifact.redacted === true, 'capture is redacted');
    check(artifact.captureError === undefined, 'capture did not degrade');
  }
} finally {
  server.stop();
  rmSync('.goldseam', { recursive: true, force: true });
}

finish('SYSTEM TEST');
