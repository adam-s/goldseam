import { describe, expect, it } from 'vitest';
import { buildReport, renderMarkdown } from '../src/cli/report';
import { FailureArtifact } from '../src/shared/types';
import { HealArtifact } from '../src/heal/types';

const capture = (title: string, spec = 'cypress/e2e/a.cy.ts'): FailureArtifact => ({
  schemaVersion: 1,
  title,
  specPath: spec,
  errorMessage: 'Expected to find element: `#x`',
  failedSelector: '#x',
  url: 'http://localhost/',
  domHtml: '<html></html>',
  ariaSnapshot: '',
  redacted: true,
});

const heal = (verdict: HealArtifact['verdict']): HealArtifact => ({
  schemaVersion: 1,
  captureRef: 'a.json',
  specPath: 'cypress/e2e/a.cy.ts',
  title: 't',
  model: 'cmd:stub',
  tier: 'model',
  verdict,
  attempts: [{ attempt: 1, ladder: [] }],
  finalEdits:
    verdict === 'healed'
      ? [{ file: 'cypress/e2e/a.cy.ts', oldString: `'#x'`, newString: `'#y'` }]
      : undefined,
  confidence: verdict === 'healed' ? 0.9 : undefined,
  durationMs: 10,
});

describe('buildReport', () => {
  it('joins captures with heals and counts verdicts', () => {
    const report = buildReport([
      { captureFile: 'a.json', capture: capture('healed one'), heal: heal('healed') },
      { captureFile: 'b.json', capture: capture('gave up one'), heal: heal('gave-up') },
      { captureFile: 'c.json', capture: capture('unprocessed') },
    ]);
    expect(report.totals).toEqual({ captures: 3, healed: 1, gaveUp: 1, failed: 0, unhealed: 1 });
  });

  it('marks captures without heal artifacts as unhealed', () => {
    const report = buildReport([{ captureFile: 'c.json', capture: capture('x') }]);
    expect(report.rows[0].verdict).toBe('unhealed');
    expect(report.rows[0].failedSelector).toBe('#x');
  });

  it('leads with failures, ends with healed', () => {
    const report = buildReport([
      { captureFile: 'a.json', capture: capture('h'), heal: heal('healed') },
      { captureFile: 'b.json', capture: capture('f'), heal: heal('failed') },
    ]);
    expect(report.rows.map((r) => r.verdict)).toEqual(['failed', 'healed']);
  });

  it('summarizes the final edit on one line', () => {
    const report = buildReport([
      { captureFile: 'a.json', capture: capture('h'), heal: heal('healed') },
    ]);
    expect(report.rows[0].edit).toBe(`'#x' → '#y'`);
  });
});

describe('renderMarkdown', () => {
  it('renders totals and a row per capture', () => {
    const md = renderMarkdown(
      buildReport([
        { captureFile: 'a.json', capture: capture('pays with card'), heal: heal('healed') },
        { captureFile: 'b.json', capture: capture('empty cart') },
      ]),
    );
    expect(md).toContain('**1 healed**');
    expect(md).toContain('pays with card');
    expect(md).toContain('| unhealed | empty cart |');
    expect(md).toContain('`#x`');
  });
});
