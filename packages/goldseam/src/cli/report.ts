// `goldseam report` — join capture + heal artifacts into per-test rows.
// Everything the incumbents' users beg for in their issue queues: a
// test-case mapping, exportable formats, no server. Pure functions here;
// the CLI is a thin fs wrapper.

import { FailureArtifact } from '../shared/types';
import { HealArtifact } from '../heal/types';

export interface ReportEntry {
  captureFile: string;
  capture: FailureArtifact;
  heal?: HealArtifact;
}

export interface ReportRow {
  title: string;
  specPath: string;
  failedSelector?: string;
  /** 'unhealed' = captured but `goldseam heal` hasn't produced a verdict. */
  verdict: 'healed' | 'gave-up' | 'failed' | 'unhealed';
  model?: string;
  tier?: string;
  confidence?: number;
  attempts?: number;
  edit?: string;
}

export interface HealReport {
  totals: { captures: number; healed: number; gaveUp: number; failed: number; unhealed: number };
  rows: ReportRow[];
}

const summarizeEdit = (heal: HealArtifact): string | undefined => {
  const edit = heal.finalEdit;
  if (!edit) return undefined;
  const line = `${edit.oldString.trim()} → ${edit.newString.trim()}`.replace(/\s+/g, ' ');
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
};

export function buildReport(entries: ReportEntry[]): HealReport {
  const rows = entries.map(({ capture, heal }): ReportRow => ({
    title: capture.title,
    specPath: capture.specPath,
    failedSelector: capture.failedSelector,
    verdict: heal?.verdict ?? 'unhealed',
    model: heal?.model,
    tier: heal?.tier,
    confidence: heal?.confidence,
    attempts: heal?.attempts.length,
    edit: heal ? summarizeEdit(heal) : undefined,
  }));
  // Failures first — the report should lead with what needs a human.
  const order = { failed: 0, unhealed: 1, 'gave-up': 2, healed: 3 } as const;
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.specPath.localeCompare(b.specPath));
  return {
    totals: {
      captures: rows.length,
      healed: rows.filter((r) => r.verdict === 'healed').length,
      gaveUp: rows.filter((r) => r.verdict === 'gave-up').length,
      failed: rows.filter((r) => r.verdict === 'failed').length,
      unhealed: rows.filter((r) => r.verdict === 'unhealed').length,
    },
    rows,
  };
}

export function renderMarkdown(report: HealReport): string {
  const { totals, rows } = report;
  const lines = [
    '# goldseam report',
    '',
    `${totals.captures} capture(s): **${totals.healed} healed**, ${totals.gaveUp} gave up, ${totals.failed} failed, ${totals.unhealed} unhealed.`,
    '',
  ];
  if (rows.length > 0) {
    lines.push(
      '| Verdict | Test | Spec | Broken selector | Edit | Confidence | Attempts | Model |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map((r) =>
        [
          '',
          r.verdict,
          r.title,
          r.specPath,
          r.failedSelector ? `\`${r.failedSelector}\`` : '—',
          r.edit ? `\`${r.edit}\`` : '—',
          r.confidence ?? '—',
          r.attempts ?? '—',
          r.model ?? '—',
          '',
        ].join(' | ').trim(),
      ),
    );
  }
  return `${lines.join('\n')}\n`;
}
