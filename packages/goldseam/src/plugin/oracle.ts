// The known-good identity manifest (.goldseam/oracle.json). Green runs
// with `recordOracles` harvest (specPath, title, selector) → aria
// identity; the oracle rung later requires a heal for that selector to
// land on the same identity. Pure merge logic here; the task wrapper in
// plugin/index.ts is thin.

import { existsSync, readFileSync } from 'fs';
import { writeJsonAtomic } from '../shared/fs';
import { OracleEntry } from '../heal/types';

export interface OracleRecordPayload {
  specPath: string;
  title: string;
  entries: Array<{ selector: string; role: string; name: string }>;
}

/** Last write wins per (specPath, title, selector); hand-written entries
 * (no selector) are never touched by the harvest. */
export function mergeOracles(existing: OracleEntry[], payload: OracleRecordPayload): OracleEntry[] {
  const keep = existing.filter(
    (e) =>
      !e.selector ||
      e.specPath !== payload.specPath ||
      e.title !== payload.title ||
      !payload.entries.some((n) => n.selector === e.selector),
  );
  return [
    ...keep,
    ...payload.entries.map((n) => ({
      specPath: payload.specPath,
      title: payload.title,
      selector: n.selector,
      role: n.role,
      name: n.name,
    })),
  ];
}

export function recordOracleEntries(file: string, payload: OracleRecordPayload): null {
  let existing: OracleEntry[] = [];
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed as OracleEntry[];
    } catch {
      // corrupt manifest regenerates — never break a green run over it
    }
  }
  writeJsonAtomic(file, mergeOracles(existing, payload));
  return null; // cy.task contract: undefined is an error, null is success
}
