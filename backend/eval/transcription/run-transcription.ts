/**
 * Offline transcription evaluation (LIVE-033).
 *
 *   pnpm --filter backend eval:transcription
 *   pnpm --filter backend eval:transcription -- --hypotheses <dir>
 *
 * Measures WER/CER, critical-term errors (names, numbers, dates, percentages,
 * units, negations) per condition (clean / noise / interruption / overlap)
 * and window latency. Simulated hypotheses validate the tool only; model
 * quality requires recorded whisper.cpp outputs on real media (LIVE-000).
 */
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from '#/live/transcription.js';
import {
  TRANSCRIPTION_LANGUAGE,
  TRANSCRIPTION_SAMPLE_RATE,
} from '#/live/transcription.js';
import {
  blockingFailures,
  evaluateGate,
  formatGate,
  formatRatio,
  isEntrypoint,
  percentile,
  ratio,
  selfCheck,
  type GateDefinition,
  type GateResult,
  type Ratio,
  type SelfCheck,
} from '../common/gates.js';
import { applyRecordedHypotheses, loadTranscriptionFixtures } from './load.js';
import {
  charEdits,
  criticalTermOutcomes,
  totalEdits,
  wordEdits,
  type CriticalTermOutcome,
  type EditCounts,
} from './text.js';
import type { CriticalCategory, TranscriptionFixture } from './types.js';

/**
 * Replays a fixture hypothesis through the real {@link TranscriptionProvider}
 * contract so recorded outputs and live adapters share one code path.
 */
export class ReplayTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'replay-fixture';
  constructor(private readonly text: string) {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
  transcribe(
    _pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    return Promise.resolve({
      text: this.text,
      segments: [{ text: this.text, startMs: 0, endMs: options.durationMs }],
    });
  }
}

export type FixtureOutcome = {
  fixture: TranscriptionFixture;
  hypothesisText: string;
  words: EditCounts;
  chars: EditCounts;
  critical: CriticalTermOutcome[];
  detectedCriticalErrors: string[];
};

const NUMERIC: ReadonlySet<CriticalCategory> = new Set([
  'NUMBER',
  'DATE',
  'PERCENT',
  'UNIT',
]);

/** Provisional targets — must be approved/adjusted in LIVE-000. */
export const TRANSCRIPTION_GATES: Record<string, GateDefinition> = {
  wer: {
    id: 'wer',
    description: 'WER global (S+D+I / palavras de referência)',
    comparator: '<=',
    threshold: 0.15,
    minSamples: 50,
    kind: 'BLOCKING',
  },
  cer: {
    id: 'cer',
    description: 'CER global (edições / caracteres de referência)',
    comparator: '<=',
    threshold: 0.1,
    minSamples: 200,
    kind: 'BLOCKING',
  },
  criticalErrors: {
    id: 'critical-error-rate',
    description: 'Erros em termos críticos / ocorrências críticas anotadas',
    comparator: '<=',
    threshold: 0.1,
    minSamples: 20,
    kind: 'BLOCKING',
  },
  negation: {
    id: 'negation-errors',
    description: '“não” perdido ou inserido / negações anotadas (tolerância zero)',
    comparator: '<=',
    threshold: 0,
    minSamples: 3,
    kind: 'BLOCKING',
  },
  numeric: {
    id: 'numeric-errors',
    description: 'Erros em números, datas, percentuais e unidades / ocorrências',
    comparator: '<=',
    threshold: 0.05,
    minSamples: 10,
    kind: 'BLOCKING',
  },
  properNames: {
    id: 'proper-name-errors',
    description: 'Erros em nomes próprios / ocorrências',
    comparator: '<=',
    threshold: 0.25,
    minSamples: 5,
    kind: 'BLOCKING',
  },
  realTime: {
    id: 'windows-within-real-time',
    description: 'Janelas com processamento <= duração / janelas medidas',
    comparator: '>=',
    threshold: 0.95,
    minSamples: 3,
    kind: 'BLOCKING',
  },
  latency: {
    id: 'window-latency-under-5s',
    description: 'Janelas processadas em <= 5000 ms / janelas medidas',
    comparator: '>=',
    threshold: 0.9,
    minSamples: 3,
    kind: 'BLOCKING',
  },
  realMedia: {
    id: 'real-debate-recorded-minutes',
    description:
      'ms de debate real com hipótese gravada / 30 min exigidos para declarar o modelo qualificado',
    comparator: '>=',
    threshold: 1,
    minSamples: 1,
    kind: 'READINESS',
  },
};

export const REQUIRED_REAL_MEDIA_MS = 30 * 60 * 1000;
export const LATENCY_BUDGET_MS = 5000;

function critKey(outcome: CriticalTermOutcome): string {
  return `${outcome.term.category}:${outcome.term.text}`;
}

export async function evaluateFixture(
  fixture: TranscriptionFixture,
): Promise<FixtureOutcome> {
  const provider = new ReplayTranscriptionProvider(fixture.hypothesis.text);
  const samples = Math.round(
    (fixture.media.durationMs / 1000) * TRANSCRIPTION_SAMPLE_RATE,
  );
  const result = await provider.transcribe(Buffer.alloc(samples * 2), {
    sampleRate: TRANSCRIPTION_SAMPLE_RATE,
    language: TRANSCRIPTION_LANGUAGE,
    startSample: 0,
    durationMs: fixture.media.durationMs,
  });
  const critical = criticalTermOutcomes(
    fixture.reference.text,
    result.text,
    fixture.reference.criticalTerms,
  );
  return {
    fixture,
    hypothesisText: result.text,
    words: wordEdits(fixture.reference.text, result.text),
    chars: charEdits(fixture.reference.text, result.text),
    critical,
    detectedCriticalErrors: critical
      .filter((item) => item.errors > 0)
      .map(critKey)
      .sort(),
  };
}

export type TranscriptionMetrics = {
  wer: Ratio;
  cer: Ratio;
  criticalErrors: Ratio;
  byCategory: Record<string, Ratio>;
  byCondition: Record<string, Ratio>;
  numeric: Ratio;
  withinRealTime: Ratio;
  underLatencyBudget: Ratio;
  latencyMs: { p50: number | null; p95: number | null; measured: number };
  realTimeFactor: { p50: number | null; p95: number | null };
  realMediaMs: Ratio;
};

export function computeTranscriptionMetrics(
  outcomes: readonly FixtureOutcome[],
): TranscriptionMetrics {
  let wordEditsTotal = 0;
  let wordRef = 0;
  let charEditsTotal = 0;
  let charRef = 0;
  let critErrors = 0;
  let critSlots = 0;
  let numericErrors = 0;
  let numericSlots = 0;
  const category: Record<string, { errors: number; slots: number }> = {};
  const condition: Record<string, { edits: number; ref: number }> = {};
  const latencies: number[] = [];
  const rtfs: number[] = [];
  let withinRealTime = 0;
  let underBudget = 0;
  let realMediaMs = 0;

  for (const outcome of outcomes) {
    const edits = totalEdits(outcome.words);
    wordEditsTotal += edits;
    wordRef += outcome.words.referenceLength;
    charEditsTotal += totalEdits(outcome.chars);
    charRef += outcome.chars.referenceLength;
    const cond = condition[outcome.fixture.condition] ?? { edits: 0, ref: 0 };
    cond.edits += edits;
    cond.ref += outcome.words.referenceLength;
    condition[outcome.fixture.condition] = cond;

    for (const item of outcome.critical) {
      critErrors += item.errors;
      critSlots += item.slots;
      const bucket = category[item.term.category] ?? { errors: 0, slots: 0 };
      bucket.errors += item.errors;
      bucket.slots += item.slots;
      category[item.term.category] = bucket;
      if (NUMERIC.has(item.term.category)) {
        numericErrors += item.errors;
        numericSlots += item.slots;
      }
    }

    const processing = outcome.fixture.hypothesis.processingMs;
    if (processing !== undefined) {
      latencies.push(processing);
      rtfs.push(processing / outcome.fixture.media.durationMs);
      if (processing <= outcome.fixture.media.durationMs) {
        withinRealTime += 1;
      }
      if (processing <= LATENCY_BUDGET_MS) {
        underBudget += 1;
      }
    }

    if (
      outcome.fixture.media.kind === 'REAL_DEBATE' &&
      outcome.fixture.hypothesis.provenance === 'RECORDED'
    ) {
      realMediaMs += outcome.fixture.media.durationMs;
    }
  }

  return {
    wer: ratio(wordEditsTotal, wordRef),
    cer: ratio(charEditsTotal, charRef),
    criticalErrors: ratio(critErrors, critSlots),
    byCategory: Object.fromEntries(
      Object.entries(category).map(([key, value]) => [
        key,
        ratio(value.errors, value.slots),
      ]),
    ),
    byCondition: Object.fromEntries(
      Object.entries(condition).map(([key, value]) => [
        key,
        ratio(value.edits, value.ref),
      ]),
    ),
    numeric: ratio(numericErrors, numericSlots),
    withinRealTime: ratio(withinRealTime, latencies.length),
    underLatencyBudget: ratio(underBudget, latencies.length),
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      measured: latencies.length,
    },
    realTimeFactor: { p50: percentile(rtfs, 50), p95: percentile(rtfs, 95) },
    realMediaMs: ratio(realMediaMs, REQUIRED_REAL_MEDIA_MS),
  };
}

export function computeTranscriptionGates(
  metrics: TranscriptionMetrics,
  options: { minSamplesOverride?: number } = {},
): GateResult[] {
  const gate = (definition: GateDefinition, value: Ratio): GateResult =>
    evaluateGate(
      options.minSamplesOverride === undefined
        ? definition
        : { ...definition, minSamples: options.minSamplesOverride },
      value,
    );
  const g = TRANSCRIPTION_GATES;
  return [
    gate(g['wer'], metrics.wer),
    gate(g['cer'], metrics.cer),
    gate(g['criticalErrors'], metrics.criticalErrors),
    gate(g['negation'], metrics.byCategory['NEGATION'] ?? ratio(0, 0)),
    gate(g['numeric'], metrics.numeric),
    gate(g['properNames'], metrics.byCategory['PROPER_NAME'] ?? ratio(0, 0)),
    gate(g['realTime'], metrics.withinRealTime),
    gate(g['latency'], metrics.underLatencyBudget),
    gate(g['realMedia'], metrics.realMediaMs),
  ];
}

export type TranscriptionEvalReport = {
  outcomes: FixtureOutcome[];
  corpusMetrics: TranscriptionMetrics;
  controlMetrics: TranscriptionMetrics;
  gates: GateResult[];
  controlGates: GateResult[];
  selfChecks: SelfCheck[];
  modelReady: boolean;
};

export async function runTranscriptionEval(
  options: { hypothesesDir?: string } = {},
): Promise<TranscriptionEvalReport> {
  let fixtures = await loadTranscriptionFixtures();
  if (options.hypothesesDir !== undefined) {
    fixtures = await applyRecordedHypotheses(fixtures, options.hypothesesDir);
  }
  const outcomes: FixtureOutcome[] = [];
  for (const fixture of fixtures) {
    outcomes.push(await evaluateFixture(fixture));
  }

  const corpus = outcomes.filter((item) => item.fixture.role === 'CORPUS');
  const controls = outcomes.filter((item) => item.fixture.role === 'CONTROL');
  const corpusMetrics = computeTranscriptionMetrics(corpus);
  const controlMetrics = computeTranscriptionMetrics(controls);
  const gates = computeTranscriptionGates(corpusMetrics);
  const controlGates = computeTranscriptionGates(controlMetrics, {
    minSamplesOverride: 1,
  });

  const selfChecks: SelfCheck[] = [];
  for (const outcome of outcomes) {
    if (outcome.fixture.hypothesis.provenance !== 'SIMULATED') {
      continue;
    }
    const expected = [...outcome.fixture.expected.criticalErrors].sort();
    const ok =
      expected.length === outcome.detectedCriticalErrors.length &&
      expected.every((item, index) => item === outcome.detectedCriticalErrors[index]);
    selfChecks.push(
      selfCheck(
        `critical-detection:${outcome.fixture.id}`,
        ok,
        `esperado [${expected.join(', ')}], detectado [${outcome.detectedCriticalErrors.join(', ')}]`,
      ),
    );
    for (const item of outcome.critical) {
      if (item.referenceCount === 0 && item.term.category !== 'NEGATION') {
        selfChecks.push(
          selfCheck(
            `annotation:${outcome.fixture.id}:${item.term.text}`,
            false,
            'termo crítico anotado não aparece na referência',
          ),
        );
      }
    }
  }
  const tripped = (id: string): boolean =>
    controlGates.find((gate) => gate.id === id)?.status === 'FAIL';
  selfChecks.push(
    selfCheck(
      'gate-sensitivity:negation',
      tripped('negation-errors'),
      'controles com “não” perdido/inserido devem reprovar o gate de negação',
    ),
    selfCheck(
      'gate-sensitivity:numeric',
      tripped('numeric-errors'),
      'controle com percentual trocado deve reprovar o gate numérico',
    ),
    selfCheck(
      'gate-sensitivity:real-time',
      tripped('windows-within-real-time'),
      'controle com janela mais lenta que o tempo real deve reprovar o gate',
    ),
  );

  const modelReady =
    gates.every((gate) => gate.status === 'PASS') &&
    corpus.every((item) => item.fixture.hypothesis.provenance === 'RECORDED');

  return {
    outcomes,
    corpusMetrics,
    controlMetrics,
    gates,
    controlGates,
    selfChecks,
    modelReady,
  };
}

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(0)} ms`;
}

export function formatTranscriptionReport(report: TranscriptionEvalReport): string {
  const m = report.corpusMetrics;
  const provenance = new Map<string, number>();
  for (const outcome of report.outcomes) {
    const key = `${outcome.fixture.hypothesis.provenance}/${outcome.fixture.media.kind}`;
    provenance.set(key, (provenance.get(key) ?? 0) + 1);
  }
  const lines: string[] = [
    'Avaliação de transcrição (LIVE-033) — métricas com denominadores',
    `Proveniência das hipóteses: ${[...provenance.entries()].map(([key, n]) => `${key}=${String(n)}`).join(', ')}`,
    'AVISO: hipóteses SIMULATED/TEXT_SIMULATED validam a ferramenta de medição, não o modelo. Qualidade do modelo exige saídas gravadas do whisper.cpp em mídia real (LIVE-000).',
    '',
    `Corpus (${String(report.outcomes.filter((o) => o.fixture.role === 'CORPUS').length)} janelas):`,
    `  WER: ${formatRatio(m.wer)}`,
    `  CER: ${formatRatio(m.cer)}`,
    `  Termos críticos com erro: ${formatRatio(m.criticalErrors)}`,
  ];
  for (const [key, value] of Object.entries(m.byCategory)) {
    lines.push(`    - ${key}: ${formatRatio(value)}`);
  }
  lines.push('  WER por condição:');
  for (const [key, value] of Object.entries(m.byCondition)) {
    lines.push(`    - ${key}: ${formatRatio(value)}`);
  }
  lines.push(
    `  Latência por janela: p50 ${formatMs(m.latencyMs.p50)}, p95 ${formatMs(m.latencyMs.p95)} (${String(m.latencyMs.measured)} medidas); RTF p95 ${m.realTimeFactor.p95?.toFixed(2) ?? 'n/a'}`,
    '',
    'Janelas (mídia, janela, modelo/hardware, duração):',
  );
  for (const outcome of report.outcomes) {
    const f = outcome.fixture;
    lines.push(
      `  - ${f.id} [${f.role}/${f.condition}] mídia=${f.media.kind} ref="${f.media.reference}" offset=${String(f.media.offsetMs)}ms dur=${String(f.media.durationMs)}ms janela=${String(f.media.window.sizeMs)}/${String(f.media.window.overlapMs)}ms modelo="${f.hypothesis.model}" hw="${f.hypothesis.hardware}" proc=${formatMs(f.hypothesis.processingMs ?? null)} WER=${String(totalEdits(outcome.words))}/${String(outcome.words.referenceLength)} críticos=[${outcome.detectedCriticalErrors.join(', ')}]`,
    );
  }
  lines.push('', 'Gates (corpus):');
  for (const gate of report.gates) {
    lines.push(`  ${formatGate(gate)}`);
  }
  lines.push('', 'Autochecagens do harness:');
  for (const check of report.selfChecks) {
    lines.push(`  [${check.ok ? 'OK' : 'FALHA'}] ${check.name}${check.ok ? '' : ` — ${check.detail ?? ''}`}`);
  }
  lines.push(
    '',
    `Modelo qualificado para produção: ${report.modelReady ? 'SIM' : 'NÃO — requer hipóteses gravadas em debate real (LIVE-000)'}`,
  );
  return lines.join('\n');
}

export function transcriptionEvalFailed(report: TranscriptionEvalReport): boolean {
  return (
    blockingFailures(report.gates).length > 0 ||
    report.selfChecks.some((check) => !check.ok)
  );
}

function parseArgs(argv: readonly string[]): { hypothesesDir?: string } {
  const index = argv.indexOf('--hypotheses');
  const dir = index >= 0 ? argv[index + 1] : undefined;
  return dir === undefined ? {} : { hypothesesDir: dir };
}

async function main(): Promise<void> {
  const report = await runTranscriptionEval(parseArgs(process.argv.slice(2)));
  console.log(formatTranscriptionReport(report));
  if (transcriptionEvalFailed(report)) {
    console.error('\nAvaliação de transcrição reprovada (gate bloqueante ou autochecagem).');
    process.exitCode = 1;
  }
}

if (isEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
