import type { Verification } from '@veritas/shared';
import { describe, expect, it } from 'vitest';
import {
  computeEvidenceMetrics,
  evidenceEvalFailed,
  invariantView,
  isUnsupportedDecisive,
  runEvidenceEval,
  type CaseRun,
} from '../../eval/evidence/run-evidence.js';

describe('LIVE-035 evidence + verdict eval', async () => {
  const report = await runEvidenceEval();

  it('runs in scripted-regression mode with all blocking gates green', () => {
    expect(report.mode).toMatch(/SCRIPTED_REGRESSION/);
    expect(evidenceEvalFailed(report)).toBe(false);
    expect(report.independentlyValidated).toBe(false);
  });

  it('keeps verdicts invariant when only the participant changes', () => {
    for (const run of report.runs) {
      expect(run.swapped.speakerId).not.toBe(run.verification.speakerId);
      expect(invariantView(run.swapped)).toBe(invariantView(run.verification));
    }
  });

  it('detects decisive verdicts without directional evidence', () => {
    const sample = report.runs.find((run) => run.verification.verdict === 'MISLEADING')?.verification;
    if (sample === undefined) {
      throw new Error('sem caso MISLEADING');
    }
    const onlySupports: Verification = {
      ...sample,
      evidence: sample.evidence.filter((item) => item.relation === 'SUPPORTS'),
    };
    expect(isUnsupportedDecisive(sample)).toBe(false);
    expect(isUnsupportedDecisive(onlySupports)).toBe(true);
    expect(isUnsupportedDecisive({ ...sample, verdict: 'INCONCLUSIVE', evidence: [] })).toBe(false);
  });

  it('separates factual errors from interpretive divergences', async () => {
    expect(report.metrics.interpretiveDivergences.numerator).toBeGreaterThanOrEqual(1);
    expect(report.metrics.factualErrorCorrections.numerator).toBe(0);
    const first = report.runs.at(0);
    if (first?.annotation === undefined) {
      throw new Error('sem anotação');
    }
    const withError: CaseRun = {
      ...first,
      annotation: {
        ...first.annotation,
        reviews: [
          {
            reviewerId: 'revisor-teste',
            reviewerKind: 'INDEPENDENT_HUMAN',
            reviewedAt: '2026-10-23',
            evidence: [],
            sufficient: false,
            conclusionCoherent: false,
            correction: { from: 'FALSE', to: 'SUPPORTED', kind: 'FACTUAL_ERROR', reason: 'teste', applied: true },
          },
        ],
      },
    };
    const metrics = await computeEvidenceMetrics([withError]);
    expect(metrics.factualErrorCorrections.numerator).toBe(1);
    expect(metrics.interpretiveDivergences.numerator).toBe(0);
    expect(metrics.corrections[0]?.kind).toBe('FACTUAL_ERROR');
  });

  it('reports breakdowns with n per participant without a parity target', () => {
    const participants = Object.keys(report.metrics.byParticipant);
    expect(participants.length).toBeGreaterThanOrEqual(4);
    for (const entry of Object.values(report.metrics.byParticipant)) {
      expect(entry.cases).toBeGreaterThan(0);
    }
    expect(report.gates.some((gate) => /parity|paridade/i.test(gate.id))).toBe(false);
  });

  it('requires independent human review before declaring factual quality', () => {
    const gate = report.gates.find((item) => item.id === 'independent-human-review-coverage');
    expect(gate?.kind).toBe('READINESS');
    expect(gate?.status).not.toBe('PASS');
  });
});
