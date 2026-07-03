import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FAILURE_SCHEMA_VERSION, FailureCapture } from '../src/shared/types';
import { artifactFileName, slugify, writeCaptureArtifact } from '../src/plugin/artifacts';
import { extractFailedSelector } from '../src/shared/selector';

const capture: FailureCapture = {
  title: 'checkout > pays with saved card',
  specPath: 'cypress/e2e/checkout.cy.ts',
  errorMessage: 'Timed out retrying: Expected to find element: `[data-cy=pay]`',
  url: 'http://localhost:4173/checkout.html',
  domHtml: '<html></html>',
  ariaSnapshot: '- button "Pay"',
  redacted: true,
};

describe('slugify', () => {
  it('collapses non-alphanumerics and trims dashes', () => {
    expect(slugify('  Hello, World! (v2) ')).toBe('hello-world-v2');
  });
});

describe('artifactFileName', () => {
  it('is stable for the same test identity', () => {
    expect(artifactFileName(capture)).toBe(artifactFileName({ ...capture }));
  });

  it('differs when the identity differs', () => {
    expect(artifactFileName(capture)).not.toBe(
      artifactFileName({ ...capture, title: 'other test' }),
    );
  });

  it('caps slug length and keeps the 6-char hash suffix', () => {
    const name = artifactFileName({ ...capture, title: 'x'.repeat(500) });
    expect(name).toMatch(/-[0-9a-f]{6}\.json$/);
    expect(name.length).toBeLessThanOrEqual(100 + 12);
  });
});

describe('writeCaptureArtifact', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the dir and writes a schema-versioned artifact', () => {
    dir = mkdtempSync(join(tmpdir(), 'goldseam-'));
    const filePath = writeCaptureArtifact(join(dir, 'failures'), capture);
    const artifact = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(artifact.schemaVersion).toBe(FAILURE_SCHEMA_VERSION);
    expect(artifact.title).toBe(capture.title);
    expect(artifact.errorMessage).toBe(capture.errorMessage);
    expect(artifact.redacted).toBe(true);
  });

  it('derives failedSelector and leaves no tmp files behind', () => {
    dir = mkdtempSync(join(tmpdir(), 'goldseam-'));
    const failuresDir = join(dir, 'failures');
    const filePath = writeCaptureArtifact(failuresDir, capture);
    const artifact = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(artifact.failedSelector).toBe('[data-cy=pay]');
    expect(readdirSync(failuresDir).filter((f) => f.includes('.tmp'))).toHaveLength(0);
  });
});

describe('extractFailedSelector', () => {
  it('parses the backticked selector from element errors', () => {
    expect(
      extractFailedSelector(
        'Timed out retrying after 4000ms: Expected to find element: `[data-testid="buy"]`, but never found it.',
      ),
    ).toBe('[data-testid="buy"]');
  });

  it('returns undefined for non-selector errors', () => {
    expect(extractFailedSelector('expected 3 to equal 4')).toBeUndefined();
    expect(extractFailedSelector('cy.visit() failed trying to load: http://x')).toBeUndefined();
  });
});
