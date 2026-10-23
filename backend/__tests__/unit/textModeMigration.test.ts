import { describe, expect, it } from 'vitest';
import {
  FACT_CHECK_RESULT_DATA_SCHEMA,
  TEXT_MODE_RESULT_VERSION,
  VERIFICATION_SCHEMA,
  legacyConfidenceForVerification,
  notFactCheckableToLegacyFactCheckData,
  sanitizeTextModeResultForExport,
  verificationToLegacyFactCheckData,
  verdictToLegacyFlags,
  type Claim,
  type Verification,
} from '@veritas/shared';

const SOURCE = {
  id: 'src-1',
  title: 'Lei do Pix',
  publisher: 'planalto.gov.br',
  url: 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/lei/l12865.htm',
  type: 'PRIMARY' as const,
  accessedAt: '2025-01-10T12:00:00.000Z',
};

const REFUTES = {
  id: 'ev-1',
  sourceId: 'src-1',
  relation: 'REFUTES' as const,
  claimIds: ['claim-1'],
  excerpt: 'A norma que instituiu o Pix é de 2013.',
  explanation: 'Documento posterior a 2015.',
  verifiedContent: true,
};

const BASE_VERIFICATION: Verification = VERIFICATION_SCHEMA.parse({
  id: 'verification-1',
  claimId: 'claim-1',
  segmentIds: ['segment-1'],
  originalQuote: 'O Pix foi criado em 2015.',
  normalizedClaim: 'O Pix foi criado em 2015.',
  transcriptConfirmed: true,
  atomicClaim: {
    id: 'atomic-1',
    proposition: 'O Pix foi criado em 2015.',
  },
  status: 'COMPLETED',
  verdict: 'FALSE',
  conclusion: 'O Pix não foi criado em 2015.',
  contradiction: 'A norma é de 2013.',
  contradictionEvidenceIds: ['ev-1'],
  evidence: [REFUTES],
  sources: [SOURCE],
  revision: 0,
  createdAt: '2025-01-10T12:00:00.000Z',
  updatedAt: '2025-01-10T12:00:05.000Z',
});

const CLAIM: Claim = {
  id: 'claim-1',
  segmentIds: ['text-chunk-0'],
  originalQuote: 'Eu acho que foi ótimo.',
  normalizedClaim: 'Eu acho que foi ótimo.',
  status: 'DETECTED',
  notFactCheckable: true,
  atomicClaims: [],
  revision: 0,
  createdAt: '2025-01-10T12:00:00.000Z',
  updatedAt: '2025-01-10T12:00:00.000Z',
};

describe('text-mode contract migration (LIVE-016)', () => {
  it('projects Verification into legacy FACT_CHECK_RESULT fields with stable version', () => {
    const data = verificationToLegacyFactCheckData(BASE_VERIFICATION);
    const parsed = FACT_CHECK_RESULT_DATA_SCHEMA.parse(data);

    expect(parsed.resultVersion).toBe(TEXT_MODE_RESULT_VERSION);
    expect(parsed.extractedClaim).toBe('O Pix foi criado em 2015.');
    expect(parsed.sources).toEqual([SOURCE.url]);
    expect(parsed.verification?.id).toBe('verification-1');
    expect(parsed.verification?.revision).toBe(0);
    expect(parsed.flags).toBeUndefined();
  });

  it('represents verification without sources as INCONCLUSIVE', () => {
    const inconclusive = VERIFICATION_SCHEMA.parse({
      ...BASE_VERIFICATION,
      verdict: 'INCONCLUSIVE',
      conclusion: 'Não há documentos suficientes.',
      contradiction: undefined,
      contradictionEvidenceIds: undefined,
      evidence: [],
      sources: [],
      limitations: ['Nenhum documento inspecionado.'],
    });

    const data = verificationToLegacyFactCheckData(inconclusive);
    expect(data.flags).toEqual(['INCONCLUSIVE']);
    expect(data.verification?.verdict).toBe('INCONCLUSIVE');
    expect(data.sources).toEqual([]);
  });

  it('maps COMPLETED four verdicts without using INCONCLUSIVE as operational status', () => {
    expect(verdictToLegacyFlags('SUPPORTED')).toBeUndefined();
    expect(verdictToLegacyFlags('FALSE')).toBeUndefined();
    expect(verdictToLegacyFlags('MISLEADING')).toEqual(['MISLEADING']);
    expect(verdictToLegacyFlags('INCONCLUSIVE')).toEqual(['INCONCLUSIVE']);

    const failed = VERIFICATION_SCHEMA.parse({
      ...BASE_VERIFICATION,
      status: 'FAILED',
      verdict: undefined,
      conclusion: undefined,
      contradiction: undefined,
      contradictionEvidenceIds: undefined,
      evidence: [],
      sources: [],
      limitations: ['Falha técnica'],
    });
    expect(failed.status).toBe('FAILED');
    expect(failed.verdict).toBeUndefined();
    expect(legacyConfidenceForVerification(failed)).toBe(0);
  });

  it('keeps triage results without a verification attempt', () => {
    const data = notFactCheckableToLegacyFactCheckData(CLAIM);
    expect(data.verification).toBeUndefined();
    expect(data.flags).toEqual(['UNVERIFIABLE']);
    expect(FACT_CHECK_RESULT_DATA_SCHEMA.safeParse(data).success).toBe(true);
  });

  it('sanitizes credential-like strings from export snapshots', () => {
    const dirty = verificationToLegacyFactCheckData({
      ...BASE_VERIFICATION,
      conclusion: 'Contato com key=tvly-secretkey1234567890 no texto',
      limitations: ['token AIzaSyDummyKeyForTest123456789012345'],
    });
    const clean = sanitizeTextModeResultForExport(dirty);
    expect(clean.reasoning).not.toMatch(/tvly-/);
    expect(clean.verification?.limitations.join(' ')).not.toMatch(/AIza/);
    expect(clean.reasoning).toContain('[redacted]');
  });
});
