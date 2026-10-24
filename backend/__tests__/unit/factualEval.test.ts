import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../../eval/factual/metrics.js';
import { loadAllFixtures } from '../../eval/factual/load.js';
import { runFactualEval } from '../../eval/factual/runner.js';
import type { CaseCheckResult } from '../../eval/factual/types.js';

describe('LIVE-024 factual eval suite', () => {
  it('loads annotated fixtures covering the required families', async () => {
    const fixtures = await loadAllFixtures();
    const ids = new Set(fixtures.map((item) => item.id));
    const families = new Set(fixtures.map((item) => item.family));

    expect(ids.has('pix-origin-false')).toBe(true);
    expect(ids.has('auxilio-600-temporal-supported')).toBe(true);
    expect(ids.has('auxilio-600-permanent-misleading')).toBe(true);
    expect(ids.has('travels-misattributed-aggregate')).toBe(true);
    expect(ids.has('supported-auxilio-emergencial-2020')).toBe(true);
    expect(ids.has('inconclusive-insufficient')).toBe(true);
    expect(ids.has('operational-quota-deferred')).toBe(true);
    expect(ids.has('operational-blocked-transcript')).toBe(true);

    expect(families.has('pix-origin')).toBe(true);
    expect(families.has('auxilio-600')).toBe(true);
    expect(families.has('travels')).toBe(true);
    expect(families.has('supported-control')).toBe(true);

    const travels = fixtures.find(
      (item) => item.id === 'travels-misattributed-aggregate',
    );
    expect(travels?.originalQuote).toBe(
      'de 7 bilhões de reais que você gastou com a Janja.',
    );
    expect(travels?.originalQuote.includes('[Lula]')).toBe(false);
    expect(travels?.expected.editorialAnnotation).toBe('[Lula]');
  });

  it('runs offline without paid keys and reports metrics with denominators', async () => {
    const { results, metrics } = await runFactualEval();

    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(results.every((item) => item.passed)).toBe(true);

    expect(metrics.casePassRate.total).toBe(results.length);
    expect(metrics.casePassRate.passed).toBe(results.length);
    expect(metrics.casePassRate.rate).toBe(1);

    expect(metrics.contradictionCoverage.total).toBeGreaterThan(0);
    expect(metrics.contradictionCoverage.hit).toBe(
      metrics.contradictionCoverage.total,
    );

    expect(metrics.operationalSafety.total).toBeGreaterThan(0);
    expect(metrics.operationalSafety.hit).toBe(
      metrics.operationalSafety.total,
    );

    // Same criteria applied across participants (denominators present).
    expect(Object.keys(metrics.byParticipant).length).toBeGreaterThan(1);
    for (const stats of Object.values(metrics.byParticipant)) {
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.passed).toBe(stats.total);
    }
  });

  it('computeMetrics always exposes denominators even when empty', () => {
    const empty: CaseCheckResult[] = [];
    const metrics = computeMetrics(empty);
    expect(metrics.casePassRate).toEqual({ passed: 0, total: 0, rate: 0 });
    expect(metrics.contradictionCoverage.total).toBe(0);
  });
});
