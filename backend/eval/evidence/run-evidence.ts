/**
 * Evidence + verdict quality evaluation (LIVE-035).
 *
 * Mode: SCRIPTED_REGRESSION. Verdict drafts are scripted (FakeChatModel) and
 * the corpus is frozen, so this measures whether the pipeline preserves
 * evidence, invariants and equal criteria — not real-world factual accuracy.
 * Real accuracy requires sampled INDEPENDENT_HUMAN review (readiness gate).
 *
 *   pnpm --filter backend eval:evidence
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Verification } from '@veritas/shared';
import {
  blockingFailures,
  evaluateGate,
  formatGate,
  formatRatio,
  isEntrypoint,
  ratio,
  selfCheck,
  type GateDefinition,
  type GateResult,
  type Ratio,
  type SelfCheck,
} from '../common/gates.js';
import { loadAllFixtures, loadCorpusDocument } from '../factual/load.js';
import {
  evaluateCase,
  runCompletedCase,
  runOperationalCase,
} from '../factual/runner.js';
import type { CaseCheckResult, FixtureCase } from '../factual/types.js';
import {
  ANNOTATIONS_FILE_SCHEMA,
  type CaseAnnotation,
  type Review,
} from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_FIXTURES_DIR = join(HERE, 'fixtures');
export const ANNOTATIONS_PATH = join(HERE, 'annotations.json');

export const EVIDENCE_EVAL_MODE =
  'SCRIPTED_REGRESSION — vereditos roteirizados sobre corpus congelado; não é avaliação factual real';

/** Participant name used to re-run every case for the author-swap check. */
export const SWAPPED_PARTICIPANT = 'Participante Neutro X';

const DECISIVE = new Set(['SUPPORTED', 'FALSE', 'MISLEADING']);

export const EVIDENCE_GATES = {
  casePass: {
    id: 'factual-case-pass',
    description: 'casos (factual + equidade) que passam em todas as checagens',
    comparator: '>=',
    threshold: 1,
    minSamples: 10,
    kind: 'BLOCKING',
  },
  excerptFidelity: {
    id: 'excerpt-literal-in-corpus',
    description: 'trechos de evidência literalmente presentes no documento congelado',
    comparator: '>=',
    threshold: 1,
    minSamples: 15,
    kind: 'BLOCKING',
  },
  unsupported: {
    id: 'unsupported-decisive-verdicts',
    description:
      'vereditos decisivos sem evidência verificada na direção exigida (SUPPORTED→SUPPORTS, FALSE→REFUTES, MISLEADING→SUPPORTS+REFUTES/CONTEXTUALIZES)',
    comparator: '<=',
    threshold: 0,
    minSamples: 5,
    kind: 'BLOCKING',
  },
  authorSwap: {
    id: 'author-swap-invariance',
    description:
      'casos cujo status/veredito/mecanismos/contradição/aspectos não mudam ao trocar o participante',
    comparator: '>=',
    threshold: 1,
    minSamples: 10,
    kind: 'BLOCKING',
  },
  annotationCoverage: {
    id: 'annotation-coverage',
    description: 'casos com anotação de revisão (tipo de proposição + revisão)',
    comparator: '>=',
    threshold: 1,
    minSamples: 10,
    kind: 'BLOCKING',
  },
  decisivePertinence: {
    id: 'decisive-evidence-pertinence',
    description: 'evidências julgadas pertinentes em vereditos decisivos',
    comparator: '>=',
    threshold: 0.95,
    minSamples: 10,
    kind: 'BLOCKING',
  },
  sufficiency: {
    id: 'decisive-sufficiency',
    description: 'vereditos decisivos com evidência julgada suficiente',
    comparator: '>=',
    threshold: 0.9,
    minSamples: 5,
    kind: 'BLOCKING',
  },
  coherence: {
    id: 'conclusion-coherence',
    description: 'conclusões julgadas coerentes com a prova citada',
    comparator: '>=',
    threshold: 0.9,
    minSamples: 5,
    kind: 'BLOCKING',
  },
  factualErrors: {
    id: 'factual-error-corrections',
    description: 'casos revisados com correção do tipo FACTUAL_ERROR (divergência interpretativa não conta)',
    comparator: '<=',
    threshold: 0,
    minSamples: 10,
    kind: 'BLOCKING',
  },
  independentReview: {
    id: 'independent-human-review-coverage',
    description:
      'vereditos concluídos com revisão humana independente (amostra mínima de 30%; exige LIVE-000/curadoria)',
    comparator: '>=',
    threshold: 0.3,
    minSamples: 10,
    kind: 'READINESS',
  },
} as const satisfies Record<string, GateDefinition>;

export type CaseRun = {
  fixture: FixtureCase;
  source: 'factual' | 'equity';
  verification: Verification;
  swapped: Verification;
  check: CaseCheckResult;
  annotation: CaseAnnotation | undefined;
};

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function runFixture(fixture: FixtureCase): Promise<Verification> {
  return fixture.expected.status === 'COMPLETED'
    ? runCompletedCase(fixture)
    : runOperationalCase(fixture);
}

/** Fields that must not depend on who said the claim. */
export function invariantView(verification: Verification): string {
  return JSON.stringify({
    status: verification.status,
    verdict: verification.verdict ?? null,
    conclusion: verification.conclusion ?? null,
    contradiction: verification.contradiction ?? null,
    contradictionEvidenceIds: [...(verification.contradictionEvidenceIds ?? [])].sort(),
    mechanisms: verification.mechanisms.map((item) => item.code).sort(),
    supportedAspects: [...verification.supportedAspects].sort(),
    limitations: [...verification.limitations].sort(),
    evidence: verification.evidence.map((item) => `${item.id}:${item.relation}`).sort(),
  });
}

/** True when a decisive verdict lacks verified evidence in the required direction. */
export function isUnsupportedDecisive(verification: Verification): boolean {
  const verdict = verification.verdict;
  if (verification.status !== 'COMPLETED' || verdict === undefined || !DECISIVE.has(verdict)) {
    return false;
  }
  const relations = new Set(
    verification.evidence.filter((item) => item.verifiedContent).map((item) => item.relation),
  );
  switch (verdict) {
    case 'SUPPORTED':
      return !relations.has('SUPPORTS');
    case 'FALSE':
      return !relations.has('REFUTES');
    case 'MISLEADING':
      return !(relations.has('SUPPORTS') && (relations.has('REFUTES') || relations.has('CONTEXTUALIZES')));
    default:
      return false;
  }
}

export async function loadAnnotations(path = ANNOTATIONS_PATH): Promise<CaseAnnotation[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return ANNOTATIONS_FILE_SCHEMA.parse(raw);
}

type Breakdown = Record<string, { cases: number; passed: number; reviewed: number; independent: number }>;

export type EvidenceMetrics = {
  casePass: Ratio;
  excerptFidelity: Ratio;
  unsupportedDecisive: Ratio;
  authorSwap: Ratio;
  contradictionCoverage: Ratio;
  mechanismCoverage: Ratio;
  annotationCoverage: Ratio;
  pertinenceAll: Ratio;
  pertinenceDecisive: Ratio;
  reviewedExcerptFaithful: Ratio;
  sufficiency: Ratio;
  coherence: Ratio;
  factualErrorCorrections: Ratio;
  interpretiveDivergences: Ratio;
  independentReviewCoverage: Ratio;
  corrections: { caseId: string; reviewerId: string; kind: string; from: string; to: string; reason: string; applied: boolean }[];
  byParticipant: Breakdown;
  byPropositionType: Breakdown;
  byVerdict: Breakdown;
};

function counter(): { n: number; d: number } {
  return { n: 0, d: 0 };
}

function bump(c: { n: number; d: number }, hit: boolean): void {
  c.d += 1;
  if (hit) {
    c.n += 1;
  }
}

function addBreakdown(target: Breakdown, key: string, run: CaseRun): void {
  const entry = (target[key] ??= { cases: 0, passed: 0, reviewed: 0, independent: 0 });
  entry.cases += 1;
  if (run.check.passed) {
    entry.passed += 1;
  }
  if ((run.annotation?.reviews.length ?? 0) > 0) {
    entry.reviewed += 1;
  }
  if (run.annotation?.reviews.some((item) => item.reviewerKind === 'INDEPENDENT_HUMAN')) {
    entry.independent += 1;
  }
}

export async function computeEvidenceMetrics(runs: readonly CaseRun[]): Promise<EvidenceMetrics> {
  const c = {
    casePass: counter(),
    excerpt: counter(),
    unsupported: counter(),
    swap: counter(),
    contradiction: counter(),
    mechanism: counter(),
    annotated: counter(),
    pertAll: counter(),
    pertDecisive: counter(),
    faithful: counter(),
    sufficient: counter(),
    coherent: counter(),
    factualErr: counter(),
    interpretive: counter(),
    independent: counter(),
  };
  const corrections: EvidenceMetrics['corrections'] = [];
  const byParticipant: Breakdown = {};
  const byPropositionType: Breakdown = {};
  const byVerdict: Breakdown = {};

  for (const run of runs) {
    const { fixture, verification } = run;
    bump(c.casePass, run.check.passed);
    bump(c.swap, invariantView(verification) === invariantView(run.swapped));

    for (const item of fixture.evidence) {
      const source = fixture.sources.find((entry) => entry.id === item.sourceId);
      const docId = source?.corpusDocumentId;
      const body = docId === undefined ? '' : await loadCorpusDocument(docId);
      bump(c.excerpt, docId !== undefined && normalize(body).includes(normalize(item.excerpt)));
    }

    const verdict = verification.verdict;
    const decisive =
      verification.status === 'COMPLETED' && verdict !== undefined && DECISIVE.has(verdict);
    if (decisive) {
      bump(c.unsupported, isUnsupportedDecisive(verification));
    }
    const contradictionCheck = run.check.checks.find((item) => item.name === 'contradiction');
    if (contradictionCheck !== undefined) {
      bump(c.contradiction, contradictionCheck.ok);
    }
    const mechanismCheck = run.check.checks.find((item) => item.name === 'mechanisms');
    if (mechanismCheck !== undefined) {
      bump(c.mechanism, mechanismCheck.ok);
    }

    const reviews: Review[] = run.annotation?.reviews ?? [];
    bump(c.annotated, run.annotation !== undefined && reviews.length > 0);
    if (verification.status === 'COMPLETED') {
      bump(c.independent, reviews.some((item) => item.reviewerKind === 'INDEPENDENT_HUMAN'));
    }
    if (reviews.length > 0) {
      bump(c.factualErr, reviews.some((item) => item.correction?.kind === 'FACTUAL_ERROR'));
      bump(c.interpretive, reviews.some((item) => item.correction?.kind === 'INTERPRETIVE_DIVERGENCE'));
    }
    for (const review of reviews) {
      for (const judgment of review.evidence) {
        bump(c.pertAll, judgment.pertinent);
        bump(c.faithful, judgment.excerptFaithful);
        if (decisive) {
          bump(c.pertDecisive, judgment.pertinent);
        }
      }
      if (decisive && review.sufficient !== null) {
        bump(c.sufficient, review.sufficient);
      }
      if (review.conclusionCoherent !== null) {
        bump(c.coherent, review.conclusionCoherent);
      }
      if (review.correction !== undefined) {
        corrections.push({
          caseId: fixture.id,
          reviewerId: review.reviewerId,
          kind: review.correction.kind,
          from: review.correction.from,
          to: review.correction.to,
          reason: review.correction.reason,
          applied: review.correction.applied,
        });
      }
    }

    addBreakdown(byParticipant, fixture.participant, run);
    addBreakdown(byPropositionType, run.annotation?.propositionType ?? 'NÃO_ANOTADO', run);
    addBreakdown(byVerdict, verdict ?? verification.status, run);
  }

  const r = (value: { n: number; d: number }): Ratio => ratio(value.n, value.d);
  return {
    casePass: r(c.casePass),
    excerptFidelity: r(c.excerpt),
    unsupportedDecisive: r(c.unsupported),
    authorSwap: r(c.swap),
    contradictionCoverage: r(c.contradiction),
    mechanismCoverage: r(c.mechanism),
    annotationCoverage: r(c.annotated),
    pertinenceAll: r(c.pertAll),
    pertinenceDecisive: r(c.pertDecisive),
    reviewedExcerptFaithful: r(c.faithful),
    sufficiency: r(c.sufficient),
    coherence: r(c.coherent),
    factualErrorCorrections: r(c.factualErr),
    interpretiveDivergences: r(c.interpretive),
    independentReviewCoverage: r(c.independent),
    corrections,
    byParticipant,
    byPropositionType,
    byVerdict,
  };
}

export type EvidenceReport = {
  mode: string;
  runs: CaseRun[];
  metrics: EvidenceMetrics;
  gates: GateResult[];
  selfChecks: SelfCheck[];
  independentlyValidated: boolean;
};

export async function runEvidenceEval(options: {
  annotationsPath?: string;
  equityFixturesDir?: string;
} = {}): Promise<EvidenceReport> {
  const factual = await loadAllFixtures();
  const equity = await loadAllFixtures(options.equityFixturesDir ?? EVIDENCE_FIXTURES_DIR);
  const annotations = await loadAnnotations(options.annotationsPath);
  const byCase = new Map(annotations.map((item) => [item.caseId, item]));

  const runs: CaseRun[] = [];
  const all: [FixtureCase, CaseRun['source']][] = [
    ...factual.map((item): [FixtureCase, CaseRun['source']] => [item, 'factual']),
    ...equity.map((item): [FixtureCase, CaseRun['source']] => [item, 'equity']),
  ];
  for (const [fixture, source] of all) {
    const verification = await runFixture(fixture);
    const swapped = await runFixture({ ...fixture, participant: SWAPPED_PARTICIPANT });
    runs.push({
      fixture,
      source,
      verification,
      swapped,
      check: evaluateCase(fixture, verification),
      annotation: byCase.get(fixture.id),
    });
  }

  const metrics = await computeEvidenceMetrics(runs);
  const g = EVIDENCE_GATES;
  const gates = [
    evaluateGate(g.casePass, metrics.casePass),
    evaluateGate(g.excerptFidelity, metrics.excerptFidelity),
    evaluateGate(g.unsupported, metrics.unsupportedDecisive),
    evaluateGate(g.authorSwap, metrics.authorSwap),
    evaluateGate(g.annotationCoverage, metrics.annotationCoverage),
    evaluateGate(g.decisivePertinence, metrics.pertinenceDecisive),
    evaluateGate(g.sufficiency, metrics.sufficiency),
    evaluateGate(g.coherence, metrics.coherence),
    evaluateGate(g.factualErrors, metrics.factualErrorCorrections),
    evaluateGate(g.independentReview, metrics.independentReviewCoverage),
  ];

  const ids = new Set(runs.map((item) => item.fixture.id));
  const selfChecks: SelfCheck[] = [
    selfCheck('unique-case-ids', ids.size === runs.length, 'ids de caso não podem colidir entre factual e equidade'),
    selfCheck(
      'annotations-reference-known-cases',
      annotations.every((item) => ids.has(item.caseId)),
      'toda anotação deve apontar para um caso existente',
    ),
    selfCheck(
      'annotated-evidence-ids-exist',
      runs.every((run) =>
        (run.annotation?.reviews ?? []).every((review) =>
          review.evidence.every((judgment) => run.fixture.evidence.some((item) => item.id === judgment.evidenceId)),
        ),
      ),
      'julgamentos de evidência devem citar ids existentes',
    ),
    selfCheck(
      'swap-actually-changed-author',
      runs.every((run) => run.swapped.speakerId === SWAPPED_PARTICIPANT),
      'a troca de autor deve chegar à verificação',
    ),
    selfCheck(
      'unsupported-detector-trips',
      isUnsupportedDecisive({
        ...(runs.find((run) => run.verification.verdict === 'FALSE')?.verification ?? runs[0].verification),
        status: 'COMPLETED',
        verdict: 'FALSE',
        evidence: [],
      }),
      'controle: FALSO sem evidência REFUTES deve ser detectado',
    ),
  ];

  const independentlyValidated = gates
    .filter((item) => item.kind === 'READINESS')
    .every((item) => item.status === 'PASS');

  return { mode: EVIDENCE_EVAL_MODE, runs, metrics, gates, selfChecks, independentlyValidated };
}

function formatBreakdown(title: string, breakdown: Breakdown): string[] {
  const lines = [`  ${title}:`];
  for (const [key, value] of Object.entries(breakdown).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      `    - ${key}: n=${String(value.cases)}, passam=${String(value.passed)}/${String(value.cases)}, revisados=${String(value.reviewed)}/${String(value.cases)}, revisão independente=${String(value.independent)}/${String(value.cases)}`,
    );
  }
  return lines;
}

export function formatEvidenceReport(report: EvidenceReport): string {
  const m = report.metrics;
  const lines = [
    'Avaliação de evidências e vereditos (LIVE-035)',
    `Modo: ${report.mode}`,
    'AVISO: as revisões presentes são AUTHOR_ANNOTATION (autor dos fixtures). Elas sustentam regressão, não validação independente.',
    '',
    'Automático:',
    `  Casos que passam: ${formatRatio(m.casePass)}`,
    `  Trechos literais no corpus: ${formatRatio(m.excerptFidelity)}`,
    `  Vereditos decisivos sem suporte direcional: ${formatRatio(m.unsupportedDecisive)}`,
    `  Invariância à troca de autor: ${formatRatio(m.authorSwap)}`,
    `  Contradição documentada (FALSO): ${formatRatio(m.contradictionCoverage)}`,
    `  Mecanismos esperados: ${formatRatio(m.mechanismCoverage)}`,
    '',
    'Revisão (anotações):',
    `  Cobertura de anotação: ${formatRatio(m.annotationCoverage)}`,
    `  Pertinência (todas as evidências): ${formatRatio(m.pertinenceAll)}`,
    `  Pertinência (vereditos decisivos): ${formatRatio(m.pertinenceDecisive)}`,
    `  Trecho fiel segundo revisor: ${formatRatio(m.reviewedExcerptFaithful)}`,
    `  Suficiência (decisivos): ${formatRatio(m.sufficiency)}`,
    `  Coerência conclusão→prova: ${formatRatio(m.coherence)}`,
    `  Correções por erro factual: ${formatRatio(m.factualErrorCorrections)}`,
    `  Divergências interpretativas: ${formatRatio(m.interpretiveDivergences)}`,
    `  Revisão humana independente: ${formatRatio(m.independentReviewCoverage)}`,
    '',
    'Registro de correções/divergências:',
    ...(m.corrections.length === 0
      ? ['  (nenhuma)']
      : m.corrections.map(
          (item) =>
            `  - ${item.caseId} [${item.kind}] ${item.from}→${item.to} por ${item.reviewerId}${item.applied ? ' (aplicada)' : ' (não aplicada)'}: ${item.reason}`,
        )),
    '',
    'Distribuições (sem meta de paridade — vereditos seguem evidências):',
    ...formatBreakdown('Por participante', m.byParticipant),
    ...formatBreakdown('Por tipo de proposição', m.byPropositionType),
    ...formatBreakdown('Por veredito/status', m.byVerdict),
    '',
    'Gates:',
    ...report.gates.map((gate) => `  ${formatGate(gate)}`),
    '',
    'Autochecagens:',
    ...report.selfChecks.map(
      (item) => `  [${item.ok ? 'OK' : 'FALHA'}] ${item.name}${item.detail === undefined ? '' : ` — ${item.detail}`}`,
    ),
    '',
    `Qualidade factual validada por revisão independente: ${report.independentlyValidated ? 'SIM' : 'NÃO — falta amostra revisada por humanos independentes'}`,
  ];
  return lines.join('\n');
}

export function evidenceEvalFailed(report: EvidenceReport): boolean {
  return blockingFailures(report.gates).length > 0 || report.selfChecks.some((item) => !item.ok);
}

async function main(): Promise<void> {
  const report = await runEvidenceEval();
  console.log(formatEvidenceReport(report));
  for (const run of report.runs.filter((item) => !item.check.passed)) {
    console.log(`[FAIL] ${run.fixture.id}`);
    for (const item of run.check.checks.filter((entry) => !entry.ok)) {
      console.log(`  - ${item.name}: ${item.detail ?? 'falhou'}`);
    }
  }
  if (evidenceEvalFailed(report)) {
    process.exitCode = 1;
  }
}

if (isEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
