import { describe, expect, it } from 'vitest';
import { rerunVerdictFor } from '../src/heal/stages';

const run = (tests: Array<[string, string]>) => ({
  runs: [{ tests: tests.map(([title, state]) => ({ title: title.split(' > '), state })) }],
});

describe('rerunVerdictFor', () => {
  it('passes when the healed test passes and nothing else fails', () => {
    const v = rerunVerdictFor('rerun-spec', run([['suite > a', 'passed']]), 'suite a', []);
    expect(v.pass).toBe(true);
  });

  it('fails when the healed test still fails', () => {
    const v = rerunVerdictFor('rerun-test', run([['suite > a', 'failed']]), 'suite a', []);
    expect(v.pass).toBe(false);
    expect(v.evidence).toContain('still failed');
  });

  it('fails when the healed test did not run (bad grep, wrong spec)', () => {
    const v = rerunVerdictFor('rerun-test', run([['suite > b', 'passed']]), 'suite a', []);
    expect(v.pass).toBe(false);
    expect(v.evidence).toContain('did not run');
  });

  it('rerun-spec tolerates known pending breaks', () => {
    const v = rerunVerdictFor(
      'rerun-spec',
      run([
        ['suite > a', 'passed'],
        ['suite > b', 'failed'],
      ]),
      'suite a',
      ['suite b'],
    );
    expect(v.pass).toBe(true);
    expect(v.evidence).toContain('known pending');
  });

  it('rerun-spec rejects NEW failures the heal introduced', () => {
    const v = rerunVerdictFor(
      'rerun-spec',
      run([
        ['suite > a', 'passed'],
        ['suite > c', 'failed'],
      ]),
      'suite a',
      ['suite b'],
    );
    expect(v.pass).toBe(false);
    expect(v.evidence).toContain('broke other test');
  });
});
