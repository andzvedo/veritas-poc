import type { CaseCheckResult, EvalMetrics } from './types.js';

function rate(hit: number, total: number): number {
  return total === 0 ? 0 : hit / total;
}

function bucket(): { passed: number; total: number; rate: number } {
  return { passed: 0, total: 0, rate: 0 };
}

/**
 * Aggregates per-case checks into metrics that always expose denominators
 * (LIVE-024): never a bare percentage without totals.
 */
export function computeMetrics(
  results: readonly CaseCheckResult[],
): EvalMetrics {
  const casePassRate = {
    passed: results.filter((item) => item.passed).length,
    total: results.length,
    rate: 0,
  };
  casePassRate.rate = rate(casePassRate.passed, casePassRate.total);

  const contradictionCoverage = { hit: 0, total: 0, rate: 0 };
  const mechanismCoverage = { hit: 0, total: 0, rate: 0 };
  const operationalSafety = { hit: 0, total: 0, rate: 0 };
  const byFamily: EvalMetrics['byFamily'] = {};
  const byParticipant: EvalMetrics['byParticipant'] = {};

  for (const result of results) {
    const family = byFamily[result.family] ?? bucket();
    family.total += 1;
    if (result.passed) {
      family.passed += 1;
    }
    family.rate = rate(family.passed, family.total);
    byFamily[result.family] = family;

    const participant = byParticipant[result.participant] ?? bucket();
    participant.total += 1;
    if (result.passed) {
      participant.passed += 1;
    }
    participant.rate = rate(participant.passed, participant.total);
    byParticipant[result.participant] = participant;

    const contradictionCheck = result.checks.find(
      (check) => check.name === 'contradiction',
    );
    if (contradictionCheck !== undefined) {
      contradictionCoverage.total += 1;
      if (contradictionCheck.ok) {
        contradictionCoverage.hit += 1;
      }
    }

    const mechanismCheck = result.checks.find(
      (check) => check.name === 'mechanisms',
    );
    if (mechanismCheck !== undefined) {
      mechanismCoverage.total += 1;
      if (mechanismCheck.ok) {
        mechanismCoverage.hit += 1;
      }
    }

    const operationalCheck = result.checks.find(
      (check) => check.name === 'no-invented-verdict',
    );
    if (operationalCheck !== undefined) {
      operationalSafety.total += 1;
      if (operationalCheck.ok) {
        operationalSafety.hit += 1;
      }
    }
  }

  contradictionCoverage.rate = rate(
    contradictionCoverage.hit,
    contradictionCoverage.total,
  );
  mechanismCoverage.rate = rate(
    mechanismCoverage.hit,
    mechanismCoverage.total,
  );
  operationalSafety.rate = rate(
    operationalSafety.hit,
    operationalSafety.total,
  );

  return {
    casePassRate,
    contradictionCoverage,
    mechanismCoverage,
    operationalSafety,
    byFamily,
    byParticipant,
  };
}

export function formatMetricsReport(metrics: EvalMetrics): string {
  const lines: string[] = [
    'Suíte factual offline (LIVE-024) — métricas com denominadores',
    `Casos: ${String(metrics.casePassRate.passed)}/${String(metrics.casePassRate.total)} (${(metrics.casePassRate.rate * 100).toFixed(1)}%)`,
    `Contradição (FALSE): ${String(metrics.contradictionCoverage.hit)}/${String(metrics.contradictionCoverage.total)}`,
    `Mecanismos (MISLEADING/FALSE anotados): ${String(metrics.mechanismCoverage.hit)}/${String(metrics.mechanismCoverage.total)}`,
    `Segurança operacional (sem veredito inventado): ${String(metrics.operationalSafety.hit)}/${String(metrics.operationalSafety.total)}`,
    'Por família:',
  ];

  for (const [family, stats] of Object.entries(metrics.byFamily)) {
    lines.push(
      `  - ${family}: ${String(stats.passed)}/${String(stats.total)}`,
    );
  }

  lines.push('Por participante (mesmos critérios):');
  for (const [participant, stats] of Object.entries(metrics.byParticipant)) {
    lines.push(
      `  - ${participant}: ${String(stats.passed)}/${String(stats.total)}`,
    );
  }

  return lines.join('\n');
}
