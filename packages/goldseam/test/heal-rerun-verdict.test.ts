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

  describe('hook-failure captures (proving-campaign, TodoMVC)', () => {
    const hookTitle = 'todos "before each" hook';
    it('passes when the suite runs past the healed hook and stays green', () => {
      const result = { runs: [{ tests: [
        { title: ['todos', 'adds'], state: 'passed' },
        { title: ['todos', 'clears'], state: 'passed' },
      ] }] };
      const v = rerunVerdictFor('rerun-test', result, hookTitle, []);
      expect(v.pass).toBe(true);
      expect(v.evidence).toMatch(/2 test\(s\) ran past the hook/);
    });
    it('fails when no tests ran (suite still aborts)', () => {
      const v = rerunVerdictFor('rerun-test', { runs: [{ tests: [] }] }, hookTitle, []);
      expect(v.pass).toBe(false);
      expect(v.evidence).toMatch(/no tests ran/);
    });
    it('fails when a non-pending test still fails after the hook heal', () => {
      const result = { runs: [{ tests: [
        { title: ['todos', 'adds'], state: 'passed' },
        { title: ['todos', 'clears'], state: 'failed' },
      ] }] };
      const v = rerunVerdictFor('rerun-test', result, hookTitle, []);
      expect(v.pass).toBe(false);
      expect(v.evidence).toMatch(/still fail/);
    });
    it('tolerates known pending breaks', () => {
      const result = { runs: [{ tests: [
        { title: ['todos', 'adds'], state: 'passed' },
        { title: ['todos', 'clears'], state: 'failed' },
      ] }] };
      const v = rerunVerdictFor('rerun-test', result, hookTitle, ['todos clears']);
      expect(v.pass).toBe(true);
    });
  });
});
