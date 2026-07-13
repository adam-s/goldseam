import { describe, expect, it } from 'vitest';
import { matchExclusion } from '../src/heal/exclude';
import { FailureArtifact } from '../src/shared/types';

const cap = (o: Partial<FailureArtifact> = {}): FailureArtifact => ({
  schemaVersion: 1,
  title: 'checkout > rejects an expired card',
  specPath: 'cypress/e2e/security/payments.cy.ts',
  errorMessage: 'x',
  url: 'http://x/',
  domHtml: '',
  ariaSnapshot: '',
  redacted: true,
  failedSelector: '[data-testid="pay-button"]',
  ...o,
});

describe('matchExclusion', () => {
  it('a bare string substring-matches the spec path OR the title', () => {
    expect(matchExclusion(cap(), ['security/'])?.reason).toMatch(/security/);
    expect(matchExclusion(cap(), ['expired card'])?.reason).toMatch(/expired card/);
    expect(matchExclusion(cap(), ['nope'])).toBeNull();
  });

  it('an object ANDs whichever of spec/title/selector are present', () => {
    expect(matchExclusion(cap(), [{ spec: 'payments' }])).not.toBeNull();
    expect(matchExclusion(cap(), [{ selector: 'pay-button' }])).not.toBeNull();
    // both fields must match
    expect(matchExclusion(cap(), [{ spec: 'payments', title: 'expired' }])).not.toBeNull();
    expect(matchExclusion(cap(), [{ spec: 'payments', title: 'MISSING' }])).toBeNull();
  });

  it('surfaces the human reason when given', () => {
    const m = matchExclusion(cap(), [{ title: 'expired card', reason: 'negative assertion — must stay red' }]);
    expect(m?.reason).toBe('negative assertion — must stay red');
  });

  it('an object with no match fields matches nothing (never excludes everything)', () => {
    expect(matchExclusion(cap(), [{ reason: 'oops, forgot the fields' } as never])).toBeNull();
    expect(matchExclusion(cap(), [{}])).toBeNull();
  });

  it('undefined/empty exclusion list matches nothing', () => {
    expect(matchExclusion(cap(), undefined)).toBeNull();
    expect(matchExclusion(cap(), [])).toBeNull();
  });

  it('returns the FIRST matching rule', () => {
    const m = matchExclusion(cap(), [{ spec: 'nope' }, { title: 'expired card', reason: 'first-hit' }, 'security/']);
    expect(m?.reason).toBe('first-hit');
  });

  it('tolerates a missing failedSelector for a selector rule', () => {
    expect(matchExclusion(cap({ failedSelector: undefined }), [{ selector: 'pay-button' }])).toBeNull();
  });
});
