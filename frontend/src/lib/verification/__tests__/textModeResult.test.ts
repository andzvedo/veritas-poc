import assert from 'node:assert/strict';
import test from 'node:test';
import type { FactCheckResult, Verification } from '@veritas/shared';
import {
  factCheckResultToOutcome,
  factCheckResultToResultData,
} from '../textModeResult.js';

const SOURCE = {
  id: 'src-1',
  title: 'Fonte',
  publisher: 'example.org',
  url: 'https://example.org/doc',
  type: 'PRIMARY' as const,
  accessedAt: '2025-01-10T12:00:00.000Z',
};

const SUPPORTS = {
  id: 'ev-1',
  sourceId: 'src-1',
  relation: 'SUPPORTS' as const,
  claimIds: ['claim-1'],
  excerpt: 'Trecho de apoio.',
  explanation: 'Apoia a afirmação.',
  verifiedContent: true,
};

const makeVerification = (
  overrides: Partial<Verification> = {},
): Verification =>
  ({
    id: 'verification-1',
    claimId: 'claim-1',
    segmentIds: ['segment-1'],
    originalQuote: 'Afirmação.',
    normalizedClaim: 'Afirmação.',
    transcriptConfirmed: true,
    atomicClaim: { id: 'atomic-1', proposition: 'Afirmação.' },
    status: 'COMPLETED',
    verdict: 'SUPPORTED',
    conclusion: 'Sustentada pelos documentos.',
    mechanisms: [],
    supportedAspects: [],
    limitations: [],
    evidence: [SUPPORTS],
    sources: [SOURCE],
    revision: 0,
    createdAt: '2025-01-10T12:00:00.000Z',
    updatedAt: '2025-01-10T12:00:05.000Z',
    ...overrides,
  }) as Verification;

const makeResult = (
  data: FactCheckResult['data'],
): FactCheckResult => ({
  data,
  meta: { fingerprint: 'fp', chunk: 0, seq: 0 },
});

test('absence of MISLEADING is not treated as verified without a SUPPORTED verdict', () => {
  const legacyOnly = makeResult({
    extractedClaim: 'Afirmação sem flags.',
    reasoningConfidence: 0.99,
    reasoning: 'Modelo confiante sem evidência estruturada.',
    flags: undefined,
    sources: [],
  });
  assert.equal(factCheckResultToOutcome(legacyOnly), 'pending');
});

test('SUPPORTED verification maps to verified', () => {
  const result = makeResult({
    extractedClaim: 'Afirmação.',
    reasoningConfidence: 0.9,
    reasoning: 'Sustentada.',
    verification: makeVerification({ verdict: 'SUPPORTED' }),
    resultVersion: 1,
  });
  assert.equal(factCheckResultToOutcome(result), 'verified');
  assert.equal(factCheckResultToResultData(result).id, 'verification-1');
});

test('FALSE and MISLEADING map to unverified; INCONCLUSIVE to pending', () => {
  assert.equal(
    factCheckResultToOutcome(
      makeResult({
        extractedClaim: 'x',
        reasoningConfidence: 0,
        reasoning: 'falsa',
        verification: makeVerification({
          verdict: 'FALSE',
          contradiction: 'Contradição',
          contradictionEvidenceIds: ['ev-1'],
          evidence: [
            {
              ...SUPPORTS,
              relation: 'REFUTES',
              explanation: 'Refuta.',
            },
          ],
        }),
      }),
    ),
    'unverified',
  );
  assert.equal(
    factCheckResultToOutcome(
      makeResult({
        extractedClaim: 'x',
        reasoningConfidence: 0,
        reasoning: 'enganosa',
        verification: makeVerification({
          verdict: 'MISLEADING',
          supportedAspects: ['Aspecto verdadeiro'],
          mechanisms: [
            {
              code: 'OMITTED_TIME_LIMIT',
              explanation: 'Omitiu o prazo.',
              evidenceIds: ['ev-1'],
            },
          ],
        }),
      }),
    ),
    'unverified',
  );
  assert.equal(
    factCheckResultToOutcome(
      makeResult({
        extractedClaim: 'x',
        reasoningConfidence: 0,
        reasoning: 'inconclusiva',
        verification: makeVerification({
          verdict: 'INCONCLUSIVE',
          evidence: [],
          sources: [],
          limitations: ['Faltam documentos'],
        }),
      }),
    ),
    'pending',
  );
});

test('FAILED operational status never displays as verified', () => {
  const result = makeResult({
    extractedClaim: 'x',
    reasoningConfidence: 0,
    reasoning: 'falha',
    verification: makeVerification({
      status: 'FAILED',
      verdict: undefined,
      conclusion: undefined,
      evidence: [],
      sources: [],
      limitations: ['Falha técnica'],
    }),
  });
  assert.equal(factCheckResultToOutcome(result), 'pending');
});
