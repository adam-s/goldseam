// Artifact writing, kept as pure-ish functions so the naming/schema rules
// are unit-testable without a Cypress run.

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FAILURE_SCHEMA_VERSION, FailureArtifact, FailureCapture } from '../shared/types';

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Stable per-test filename: readable slug + content-independent identity hash. */
export function artifactFileName(capture: Pick<FailureCapture, 'specPath' | 'title'>): string {
  const identity = `${capture.specPath}-${capture.title}`;
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 6);
  return `${slugify(identity).slice(0, 100)}-${hash}.json`;
}

export function toArtifact(capture: FailureCapture): FailureArtifact {
  return { schemaVersion: FAILURE_SCHEMA_VERSION, ...capture };
}

export function writeCaptureArtifact(failuresDir: string, capture: FailureCapture): string {
  const filePath = join(failuresDir, artifactFileName(capture));
  mkdirSync(failuresDir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(toArtifact(capture), null, 2));
  return filePath;
}
