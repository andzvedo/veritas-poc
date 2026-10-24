import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockingFailures, evaluateGate, ratio } from '../../eval/common/gates.js';
import { loadTranscriptionFixtures } from '../../eval/transcription/load.js';
import {
  runTranscriptionEval,
  transcriptionEvalFailed,
} from '../../eval/transcription/run-transcription.js';
import {
  charEdits,
  criticalTermOutcomes,
  tokenize,
  totalEdits,
  wordEdits,
} from '../../eval/transcription/text.js';

describe('LIVE-033 transcription eval — text metrics', () => {
  it('tokenizes keeping numbers, currency and percent', () => {
    expect(tokenize('A Selic caiu para 10,5% e R$ 600 em 21/12/2022.')).toEqual([
      'a',
      'selic',
      'caiu',
      'para',
      '10,5%',
      'e',
      'r$',
      '600',
      'em',
      '21/12/2022',
    ]);
  });

  it('counts substitutions, deletions and insertions with explicit denominator', () => {
    const counts = wordEdits('o valor não foi pago', 'o valor foi pago ontem');
    expect(counts.referenceLength).toBe(5);
    expect(counts.deletions).toBe(1);
    expect(counts.insertions).toBe(1);
    expect(totalEdits(counts)).toBe(2);
    expect(totalEdits(charEdits('abc', 'abc'))).toBe(0);
  });

  it('flags dropped and inserted negations as critical errors', () => {
    const negation = { text: 'não', category: 'NEGATION' as const, accept: [] };
    const dropped = criticalTermOutcomes('o governo não cortou', 'o governo cortou', [negation]);
    expect(dropped[0]?.errors).toBe(1);
    const inserted = criticalTermOutcomes('o governo cortou', 'o governo não cortou', [negation]);
    expect(inserted[0]?.referenceCount).toBe(0);
    expect(inserted[0]?.slots).toBe(1);
    expect(inserted[0]?.errors).toBe(1);
  });

  it('accepts annotated alternative forms for numbers', () => {
    const term = { text: '600', category: 'NUMBER' as const, accept: ['seiscentos'] };
    expect(criticalTermOutcomes('R$ 600', 'seiscentos reais', [term])[0]?.errors).toBe(0);
  });
});

describe('LIVE-033 transcription eval — gates', () => {
  it('reports insufficient sample instead of passing on tiny denominators', () => {
    const gate = evaluateGate(
      { id: 'x', description: 'x', comparator: '<=', threshold: 0.1, minSamples: 50, kind: 'BLOCKING' },
      ratio(0, 10),
    );
    expect(gate.status).toBe('INSUFFICIENT_SAMPLE');
    expect(blockingFailures([gate])).toHaveLength(1);
  });

  it('runs offline: blocking gates pass, controls trip, model is NOT ready without real media', async () => {
    const report = await runTranscriptionEval();
    expect(transcriptionEvalFailed(report)).toBe(false);
    expect(report.selfChecks.every((item) => item.ok)).toBe(true);
    expect(report.modelReady).toBe(false);
    const readiness = report.gates.find((gate) => gate.kind === 'READINESS');
    expect(readiness?.status).not.toBe('PASS');
    expect(report.corpusMetrics.wer.denominator).toBeGreaterThanOrEqual(50);
  });

  it('replaces simulated hypotheses with recorded whisper -oj output + required meta', async () => {
    const fixtures = await loadTranscriptionFixtures();
    const target = fixtures.find((item) => item.role === 'CORPUS');
    if (target === undefined) {
      throw new Error('sem fixture de corpus');
    }
    const dir = await mkdtemp(join(tmpdir(), 'veritas-whisper-'));
    await writeFile(
      join(dir, `${target.id}.json`),
      JSON.stringify({ transcription: [{ text: target.reference.text }] }),
    );
    await expect(runTranscriptionEval({ hypothesesDir: dir })).rejects.toThrow(/meta\.json/);
    await writeFile(
      join(dir, `${target.id}.meta.json`),
      JSON.stringify({ model: 'ggml-small', hardware: 'teste', processingMs: 100 }),
    );
    const report = await runTranscriptionEval({ hypothesesDir: dir });
    const outcome = report.outcomes.find((item) => item.fixture.id === target.id);
    expect(outcome?.fixture.hypothesis.provenance).toBe('RECORDED');
    expect(outcome ? totalEdits(outcome.words) : -1).toBe(0);
  });
});
