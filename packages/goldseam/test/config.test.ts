import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  GoldseamConfig,
  firstDefined,
  loadGoldseamConfig,
  resolveHealModel,
  resolvePromptModel,
} from '../src/shared/config';

// A fresh temp dir per config so each `import()` hits a distinct file URL —
// Node caches ESM modules by URL, and identical filenames would collide.
const dirs: string[] = [];
function projectWith(configSource: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'goldseam-config-'));
  dirs.push(dir);
  if (configSource !== null) writeFileSync(join(dir, 'goldseam.config.mjs'), configSource);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('firstDefined', () => {
  it('returns the first non-null, non-undefined value', () => {
    expect(firstDefined(undefined, null, 'a', 'b')).toBe('a');
  });
  it('treats 0 and false and "" as present (only null/undefined skip)', () => {
    expect(firstDefined(undefined, 0, 1)).toBe(0);
    expect(firstDefined(null, false, true)).toBe(false);
    expect(firstDefined(undefined, '', 'x')).toBe('');
  });
  it('is undefined when everything is null/undefined', () => {
    expect(firstDefined(undefined, null)).toBeUndefined();
  });
});

describe('resolveHealModel precedence: flag > GOLDSEAM_MODEL > healModel > model > default', () => {
  const cfg: GoldseamConfig = { model: 'cfg-model', healModel: 'cfg-heal' };

  it('flag wins over everything', () => {
    expect(resolveHealModel('flag', { GOLDSEAM_MODEL: 'env' }, cfg)).toBe('flag');
  });
  it('env wins when no flag', () => {
    expect(resolveHealModel(undefined, { GOLDSEAM_MODEL: 'env' }, cfg)).toBe('env');
  });
  it('healModel wins over model when no flag/env', () => {
    expect(resolveHealModel(undefined, {}, cfg)).toBe('cfg-heal');
  });
  it('falls back to shared model', () => {
    expect(resolveHealModel(undefined, {}, { model: 'cfg-model' })).toBe('cfg-model');
  });
  it('falls back to the built-in default with an empty config', () => {
    expect(resolveHealModel(undefined, {}, {})).toBe(DEFAULT_MODEL);
  });
  it('treats a blank env var as unset (GOLDSEAM_MODEL= falls through, never resolves to "")', () => {
    expect(resolveHealModel(undefined, { GOLDSEAM_MODEL: '' }, cfg)).toBe('cfg-heal');
    expect(resolveHealModel(undefined, { GOLDSEAM_MODEL: '   ' }, {})).toBe(DEFAULT_MODEL);
  });
});

describe('resolvePromptModel precedence: option > GOLDSEAM_PROMPT_MODEL > GOLDSEAM_MODEL > promptModel > model > default', () => {
  const cfg: GoldseamConfig = { model: 'cfg-model', promptModel: 'cfg-prompt' };

  it('option wins over everything', () => {
    expect(resolvePromptModel('opt', { GOLDSEAM_PROMPT_MODEL: 'penv', GOLDSEAM_MODEL: 'env' }, cfg)).toBe('opt');
  });
  it('the per-tool env outranks the shared env', () => {
    expect(resolvePromptModel(undefined, { GOLDSEAM_PROMPT_MODEL: 'penv', GOLDSEAM_MODEL: 'env' }, cfg)).toBe('penv');
  });
  it('the shared env applies when the per-tool one is unset', () => {
    expect(resolvePromptModel(undefined, { GOLDSEAM_MODEL: 'env' }, cfg)).toBe('env');
  });
  it('promptModel wins over model when no option/env', () => {
    expect(resolvePromptModel(undefined, {}, cfg)).toBe('cfg-prompt');
  });
  it('falls back to shared model, then the built-in default', () => {
    expect(resolvePromptModel(undefined, {}, { model: 'cfg-model' })).toBe('cfg-model');
    expect(resolvePromptModel(undefined, {}, {})).toBe(DEFAULT_MODEL);
  });
});

describe('loadGoldseamConfig', () => {
  it('returns {} when no config file exists (the common case, never an error)', async () => {
    const dir = projectWith(null);
    expect(await loadGoldseamConfig(dir)).toEqual({});
  });

  it('loads a default-exported object', async () => {
    const dir = projectWith(`export default { model: 'ollama:qwen2.5:14b', heal: { maxAttempts: 5 } };`);
    const cfg = await loadGoldseamConfig(dir);
    expect(cfg.model).toBe('ollama:qwen2.5:14b');
    expect(cfg.heal?.maxAttempts).toBe(5);
  });

  it('evaluates JS in the config (env fallback expressions work)', async () => {
    const dir = projectWith(`export default { model: process.env.__GS_TEST_MODEL ?? 'claude' };`);
    process.env.__GS_TEST_MODEL = 'openai:gpt-4o';
    try {
      expect((await loadGoldseamConfig(dir)).model).toBe('openai:gpt-4o');
    } finally {
      delete process.env.__GS_TEST_MODEL;
    }
  });

  it('throws a framed error when the config exists but fails to import', async () => {
    const dir = projectWith(`export default { oops: (`); // syntax error
    await expect(loadGoldseamConfig(dir)).rejects.toThrow(/goldseam\.config\.mjs failed to load/);
  });

  it('throws when the config exports a non-object', async () => {
    const dir = projectWith(`export default 'just a string';`);
    await expect(loadGoldseamConfig(dir)).rejects.toThrow(/must `export default` an object/);
  });

  it('rejects an array export (arrays are not config objects)', async () => {
    const dir = projectWith(`export default ['claude'];`);
    await expect(loadGoldseamConfig(dir)).rejects.toThrow(/must `export default` an object/);
  });

  it('rejects a config with only named exports (the documented contract is a default export)', async () => {
    const dir = projectWith(`export const model = 'ollama:qwen2.5:14b';`);
    await expect(loadGoldseamConfig(dir)).rejects.toThrow(/must `export default` an object/);
  });
});
