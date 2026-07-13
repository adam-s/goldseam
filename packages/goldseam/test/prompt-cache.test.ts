// The prompt-cache load guard. The cache is a committable, hand-editable,
// git-shared public artifact, so loadPromptCache must not trust a file whose
// schemaVersion it doesn't recognize — it returns null (→ retranslate) rather
// than replay an entry from a future breaking bump with mismatched command
// semantics. Mirrors the heal engine's capture-schema guard.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadPromptCache } from '../src/plugin/translate';
import { PROMPT_SCHEMA_VERSION } from '../src/shared/prompt-types';

let dir: string;
const write = (key: string, obj: unknown) => writeFileSync(join(dir, `${key}.json`), JSON.stringify(obj));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gs-cache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadPromptCache — schema guard', () => {
  const valid = {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    steps: ['Click Go'],
    commands: [{ action: 'click', selector: '#go' }],
    model: 'cmd:x',
    translatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('loads an entry stamped with the current schema version', () => {
    write('k', valid);
    expect(loadPromptCache(dir, 'k')).toMatchObject({ steps: ['Click Go'] });
  });

  it('rejects (→ retranslate) an entry from a newer/unknown schema version', () => {
    write('k', { ...valid, schemaVersion: PROMPT_SCHEMA_VERSION + 998 });
    expect(loadPromptCache(dir, 'k')).toBeNull();
  });

  it('rejects an entry with a missing schemaVersion', () => {
    const { schemaVersion: _omit, ...noVersion } = valid;
    write('k', noVersion);
    expect(loadPromptCache(dir, 'k')).toBeNull();
  });

  it('returns null for a missing or corrupt file', () => {
    expect(loadPromptCache(dir, 'absent')).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    expect(loadPromptCache(dir, 'bad')).toBeNull();
  });
});
