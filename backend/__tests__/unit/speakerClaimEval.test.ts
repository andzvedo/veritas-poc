import { describe, expect, it } from 'vitest';
import { loadDialogueFixtures, validateFixture } from '../../eval/speakers-claims/load.js';
import {
  quoteSimilarity,
  runSpeakerClaimEval,
  speakerClaimEvalFailed,
} from '../../eval/speakers-claims/run-speakers-claims.js';

describe('LIVE-034 speaker/claim eval', () => {
  it('quote similarity ignores accents/case and accepts contained quotes', () => {
    expect(quoteSimilarity('O PAÍS está melhor', 'o pais esta melhor')).toBe(1);
    expect(quoteSimilarity('Eu acho que o país está melhor', 'o país está melhor')).toBe(1);
    expect(quoteSimilarity('R$ 600', 'R$ 400')).toBeLessThan(0.75);
  });

  it('rejects fixtures whose gold quote is not literal in the segment', async () => {
    const fixture = (await loadDialogueFixtures()).at(0);
    if (fixture === undefined) {
      throw new Error('sem fixture');
    }
    const broken = structuredClone(fixture);
    const gold = broken.goldClaims.at(0);
    if (gold === undefined) {
      throw new Error('sem gold');
    }
    gold.quote = 'frase que não existe no segmento';
    expect(() => {
      validateFixture(broken);
    }).toThrow();
  });

  it('separates metric groups, passes blocking gates and keeps automatic authorship NOT ready', async () => {
    const report = await runSpeakerClaimEval();
    expect(speakerClaimEvalFailed(report)).toBe(false);
    expect(report.automaticAuthorshipReady).toBe(false);
    const m = report.metrics;
    // Unknown authorship never counts as a hit.
    expect(m.diarization.accuracyIncludingUnknown.rate).toBeLessThan(1);
    expect(m.diarization.errorAmongAttributed.numerator).toBeGreaterThanOrEqual(1);
    expect(m.extraction.precision.denominator).toBeGreaterThanOrEqual(10);
    expect(m.duplicates.falseMerges.numerator).toBe(0);
    expect(m.context.authorshipLeaks.numerator).toBe(0);
    expect(m.context.staleDetection.rate).toBe(1);
    const readiness = report.gates.filter((gate) => gate.kind === 'READINESS');
    expect(readiness.every((gate) => gate.status === 'INSUFFICIENT_SAMPLE')).toBe(true);
  });
});
