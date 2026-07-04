// Vague/ambiguous authoring steps must fail LOUD, not guess — the model
// replies {"giveUp":{...}} and translation throws with the reason (live
// -site proving: 'check the checkbox' with two checkboxes was refused).

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPromptCache, translateSteps, translationDom } from '../src/plugin/translate';
import { promptKey } from '../src/shared/prompt-types';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'goldseam-translate-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('translation give-up', () => {
  it('throws with the model reason and writes NO cache entry', async () => {
    await expect(
      translateSteps(
        { key: promptKey(['Check the checkbox']), steps: ['Check the checkbox'], url: 'http://x/', domHtml: '<input type=checkbox><input type=checkbox>' },
        `cmd:node ${join(__dirname, '..', '..', '..', 'scripts', 'stub-model.mjs')} translate-giveup`,
        dir,
      ),
    ).rejects.toThrow(/declined to translate.*two checkboxes/);
    // the REFUSAL is cached: reruns refuse deterministically, zero calls
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('a cached refusal replays without touching the runner', async () => {
    const payload = {
      key: promptKey(['Check the checkbox']),
      steps: ['Check the checkbox'],
      url: 'http://x/',
      domHtml: '<input type=checkbox><input type=checkbox>',
    } as Parameters<typeof translateSteps>[0];
    const stub = `cmd:node ${join(__dirname, '..', '..', '..', 'scripts', 'stub-model.mjs')} translate-giveup`;
    await expect(translateSteps(payload, stub, dir)).rejects.toThrow(/declined/);
    const entry = loadPromptCache(dir, payload.key);
    expect(entry?.giveUp?.reason).toMatch(/two checkboxes/);
    expect(entry?.commands).toEqual([]);
  });

  it('spends the DOM budget on body markup, not head/scripts/styles (Wikipedia proving)', () => {
    const bigHead = `<html><head><style>${'x'.repeat(60000)}</style></head><body><button id="go">Go</button><script>${'y'.repeat(9000)}</script></body></html>`;
    const dom = translationDom(bigHead);
    expect(dom).toContain('id="go"');
    expect(dom).not.toContain('xxxx');
    expect(dom).not.toContain('yyyy');
  });
});
