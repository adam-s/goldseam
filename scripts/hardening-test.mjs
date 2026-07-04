// Capture-hardening system tests: the behaviors probed and fixed on
// 2026-07-03, pinned so they can never silently regress.
//
// 1. retries: a flaky-then-green test leaves NO artifact (stale captures
//    would poison the healer); a test that exhausts retries leaves exactly
//    one.
// 2. hook failures: a beforeEach failure still produces a capture.
// 3. transparency: a user's own swallowing Cypress.on('fail') handler keeps
//    its exact semantics (test stays green) with goldseam installed.

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import cypress from 'cypress';
import { check, finish, startServer } from './lib/harness.mjs';

async function runScenario(name) {
  rmSync('.goldseam', { recursive: true, force: true });
  const res = await cypress.run({
    quiet: true,
    config: { specPattern: `cypress/hardening/${name}.cy.ts` },
  });
  const artifacts = existsSync('.goldseam/failures')
    ? readdirSync('.goldseam/failures').length
    : 0;
  return { passed: res.totalPassed, failed: res.totalFailed, artifacts };
}

const server = await startServer('demo', 4173);
// Second origin (same host, different port) for the cy.origin scenario.
const server2 = await startServer('demo', 4174);

try {
  console.log('\n— retries —');
  const flaky = await runScenario('retry-flaky');
  check(flaky.passed === 1, 'flaky test passes on retry');
  check(flaky.artifacts === 0, 'flaky-then-green leaves no artifact');

  const exhausted = await runScenario('retry-fail');
  check(exhausted.failed === 1, 'exhausted retries fail the test');
  check(exhausted.artifacts === 1, 'exactly one artifact after final attempt');

  console.log('\n— hook failures —');
  const hook = await runScenario('hook-failure');
  check(hook.failed === 1, 'beforeEach failure fails the test');
  check(hook.artifacts === 1, 'beforeEach failure still captures');

  console.log('\n— transparency toward user fail handlers —');
  const swallow = await runScenario('user-swallow');
  check(swallow.passed === 1 && swallow.failed === 0, "user's swallow handler keeps its test green");
  check(swallow.artifacts === 0, 'swallowed (passing) test leaves no artifact');

  console.log('\n— cy.origin: degrade honestly, never capture the runner UI —');
  const origin = await runScenario('cross-origin');
  check(origin.failed === 1 && origin.artifacts === 1, 'cross-origin failure still captures');
  const originArtifact = JSON.parse(
    readFileSync(`.goldseam/failures/${readdirSync('.goldseam/failures')[0]}`, 'utf8'),
  );
  check(
    typeof originArtifact.captureError === 'string' && originArtifact.captureError.includes('unreachable'),
    'captureError names the cross-origin degradation',
  );
  check(originArtifact.domHtml === '', 'no misleading runner-UI DOM in the capture');
} finally {
  server.stop();
  server2.stop();
  rmSync('.goldseam', { recursive: true, force: true });
}

finish('HARDENING TEST');
