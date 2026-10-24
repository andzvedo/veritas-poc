/**
 * LIVE-015 — speaker identification + claim extraction on annotated dialogue
 * fixtures. These are TEXT fixtures with scripted diarization labels and
 * scripted extractor outputs: they validate the pipeline rules (unknown
 * authorship, context, dedup, staleness), NOT diarization model quality.
 */
import { describe, expect, it } from 'vitest';
import { buildClaimKey } from '#/live/claimDeduplication.js';
import { ClaimQueue } from '#/live/claimQueue.js';
import { SpeakerRegistry } from '#/live/speakerIdentification.js';
import { loadDialogueFixtures } from '../../eval/speakers-claims/load.js';
import {
  attributeWindow,
  authorshipFor,
  computeSpeakerClaimMetrics,
  isStale,
  runDialogue,
  type DialogueRun,
} from '../../eval/speakers-claims/run-speakers-claims.js';

async function runAll(): Promise<Map<string, DialogueRun>> {
  const fixtures = await loadDialogueFixtures();
  const runs = new Map<string, DialogueRun>();
  for (const fixture of fixtures) {
    runs.set(fixture.id, await runDialogue(fixture));
  }
  return runs;
}

function byGold(run: DialogueRun, goldId: string) {
  return run.occurrences.find((item) => item.matchedGoldId === goldId);
}

describe('LIVE-015 identificação de falantes + extração', async () => {
  const runs = await runAll();
  const debate = runs.get('debate-two-participants-mediator');
  const unknown = runs.get('unknown-authorship-corrections');
  if (debate === undefined || unknown === undefined) {
    throw new Error('fixtures de diálogo ausentes');
  }

  it('dois participantes + mediador: rótulos viram speakers estáveis e o mapeamento do mediador fica não confirmado', () => {
    const a = debate.segmentSpeaker.get('s2');
    const b = debate.segmentSpeaker.get('s3');
    const m = debate.segmentSpeaker.get('s1');
    expect(new Set([a, b, m]).size).toBe(3);
    expect(debate.segmentSpeaker.get('s6')).toBe(a);
    expect(authorshipFor(debate, a, 'A')).toBe('CONFIRMED_CORRECT');
    expect(authorshipFor(debate, m, 'M')).toBe('UNCONFIRMED');
  });

  it('fala simultânea mantém autoria desconhecida (não chuta um dos rótulos)', () => {
    const registry = new SpeakerRegistry();
    expect(
      attributeWindow(
        [
          { speakerLabel: 'SPK_A', confidence: 0.9 },
          { speakerLabel: 'SPK_B', confidence: 0.8 },
        ],
        registry,
      ),
    ).toBeUndefined();
    expect(attributeWindow([], registry)).toBeUndefined();
    expect(debate.segmentSpeaker.get('s5')).toBeUndefined();
    const overlap = byGold(debate, 'g5');
    expect(overlap?.claim.speakerId).toBeUndefined();
  });

  it('erro de diarização é medido como erro, não escondido', () => {
    const s7 = debate.segmentSpeaker.get('s7');
    expect(authorshipFor(debate, s7, 'B')).toBe('CONFIRMED_WRONG');
  });

  it('claim incompleta (interrompida) não é extraída', () => {
    expect(debate.occurrences.some((item) => item.segmentId === 's4')).toBe(false);
  });

  it('trecho sem claim não gera ocorrência', () => {
    expect(debate.occurrences.some((item) => item.segmentId === 's8')).toBe(false);
  });

  it('repetição do mesmo autor reusa a investigação; mesmo fato de outro autor mantém ocorrência e autoria próprias', () => {
    const first = byGold(debate, 'g2');
    const repeat = byGold(debate, 'g6');
    const other = byGold(debate, 'g9');
    expect(first && repeat && other).toBeTruthy();
    expect(repeat?.reusedFrom?.id).toBe(first?.claim.id);
    expect(other?.claim.id).not.toBe(first?.claim.id);
    expect(other?.claim.speakerId).toBe(debate.segmentSpeaker.get('s9'));
    expect(other?.claim.speakerId).not.toBe(first?.claim.speakerId);
  });

  it('ClaimQueue: chave compartilhada dá a cada ocorrência seu próprio resultado sem nova investigação', async () => {
    const first = byGold(debate, 'g2')?.claim;
    const other = byGold(debate, 'g9')?.claim;
    if (first === undefined || other === undefined) {
      throw new Error('ocorrências ausentes');
    }
    const key = buildClaimKey(first);
    expect(buildClaimKey(other)).toBe(key);
    const queue = new ClaimQueue<{ investigation: number }>({ timeoutMs: 0 });
    let runsCount = 0;
    const run = () => {
      runsCount += 1;
      return Promise.resolve({ investigation: runsCount });
    };
    const r1 = await queue.enqueue({ id: first.id, key, run });
    const r2 = await queue.enqueue({ id: other.id, key, run });
    expect(runsCount).toBe(1);
    expect(r2).toEqual(r1);
    expect(queue.getMetrics().cacheHits).toBe(1);
  });

  it('preserva contexto: referente anterior chega ao prompt e à lista de dependências', () => {
    for (const [run, goldId, contextId, text] of [
      [debate, 'g3', 's2', 'Auxílio Brasil'],
      [debate, 'g12', 's11', 'inflação'],
      [unknown, 'h7', 't6', '7 milhões'],
    ] as const) {
      const occurrence = run.contextBySegment.get(run.fixture.goldClaims.find((g) => g.id === goldId)?.segmentId ?? '');
      expect(occurrence?.dependencies.map((dep) => dep.id)).toContain(contextId);
      expect(occurrence?.promptText).toContain(text);
    }
  });

  it('autoria do contexto não vaza para a claim do falante atual', () => {
    const g3 = byGold(debate, 'g3');
    expect(g3?.claim.speakerId).toBe(debate.segmentSpeaker.get('s3'));
    expect(g3?.claim.speakerId).not.toBe(debate.segmentSpeaker.get('s2'));
  });

  it('"não", números e unidades distintos não são fundidos como duplicata', () => {
    for (const goldId of ['h2', 'h4', 'h6']) {
      const occurrence = byGold(unknown, goldId);
      expect(occurrence).toBeDefined();
      expect(occurrence?.reusedFrom).toBeUndefined();
    }
  });

  it('autoria desconhecida (sem diarização) nunca recebe nome', () => {
    for (const occurrence of unknown.occurrences) {
      expect(occurrence.claim.speakerId).toBeUndefined();
      expect(authorshipFor(unknown, occurrence.claim.speakerId, 'A')).toBe('UNKNOWN');
    }
  });

  it('correção do contexto invalida claims dependentes (e só elas)', () => {
    for (const gold of unknown.fixture.goldClaims) {
      const occurrence = byGold(unknown, gold.id);
      if (occurrence === undefined) {
        continue;
      }
      expect({ id: gold.id, stale: isStale(unknown, occurrence) }).toEqual({ id: gold.id, stale: gold.staleAfterCorrection });
    }
  });

  it('precisão/recall no corpus anotado (texto; não mede qualidade de diarização)', () => {
    const metrics = computeSpeakerClaimMetrics([...runs.values()]);
    expect(metrics.extraction.precision.denominator).toBeGreaterThanOrEqual(10);
    expect(metrics.extraction.precision.rate).toBeGreaterThanOrEqual(0.8);
    expect(metrics.extraction.recall.rate).toBeGreaterThanOrEqual(0.8);
    // The annotated corpus contains one deliberate miss and one false positive.
    expect(metrics.extraction.recall.rate).toBeLessThan(1);
    expect(metrics.extraction.precision.rate).toBeLessThan(1);
  });
});
