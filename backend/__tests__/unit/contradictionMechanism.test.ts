import { describe, expect, it } from 'vitest';
import type { Evidence } from '@veritas/shared';
import {
  detectContradiction,
  stripInventedContradiction,
  validateContradiction,
} from '#/analysis/contradictionDetection.js';
import {
  MECHANISM_CODES,
  isKnownMechanismCode,
  mechanismsForVerdict,
  sanitizeMechanisms,
  validateMisleading,
} from '#/analysis/misleadingMechanism.js';

const REFUTES: Evidence = {
  id: 'ev-1',
  sourceId: 'src-1',
  relation: 'REFUTES',
  claimIds: ['claim-1'],
  excerpt: 'O GT foi criado em maio de 2018.',
  explanation: 'A origem antecede 2019.',
  verifiedContent: true,
};

const SUPPORTS: Evidence = {
  ...REFUTES,
  id: 'ev-2',
  relation: 'SUPPORTS',
  excerpt: 'O Pix lançou em 2020.',
  explanation: 'Lançamento no mandato.',
};

describe('LIVE-021 contradictionDetection', () => {
  it('detects a contradiction only from verified REFUTES evidence', () => {
    const finding = detectContradiction(
      [REFUTES, SUPPORTS],
      'Conflito: origem em 2018, não em 2019.',
      ['ev-1'],
    );
    expect(finding).toEqual({
      contradiction: 'Conflito: origem em 2018, não em 2019.',
      contradictionEvidenceIds: ['ev-1'],
    });
  });

  it('refuses to invent a contradiction without REFUTES', () => {
    expect(detectContradiction([SUPPORTS], 'texto', ['ev-2'])).toBeUndefined();
    const validation = validateContradiction([SUPPORTS], 'texto', ['ev-2']);
    expect(validation.ok).toBe(false);
  });

  it('strips invented contradictions from SUPPORTED candidates', () => {
    const stripped = stripInventedContradiction({
      verdict: 'SUPPORTED' as const,
      contradiction: 'não deveria existir',
      contradictionEvidenceIds: ['ev-1'],
    });
    expect(stripped).not.toHaveProperty('contradiction');
    expect(stripped).not.toHaveProperty('contradictionEvidenceIds');
  });
});

describe('LIVE-021 misleadingMechanism', () => {
  it('includes PROGRAM_CONFLATION and MISATTRIBUTED_AGGREGATE from §8', () => {
    expect(MECHANISM_CODES).toContain('PROGRAM_CONFLATION');
    expect(MECHANISM_CODES).toContain('MISATTRIBUTED_AGGREGATE');
    expect(isKnownMechanismCode('FALSE_ORIGIN_ATTRIBUTION')).toBe(true);
    expect(isKnownMechanismCode('NOT_A_CODE')).toBe(false);
  });

  it('sanitizes mechanisms that lack verified evidence ids', () => {
    const verified = new Map<string, Evidence>([
      ['ev-2', SUPPORTS],
    ]);
    const mechanisms = sanitizeMechanisms(
      [
        {
          code: 'OMITTED_TIME_LIMIT',
          explanation: 'Omite o prazo.',
          evidenceIds: ['ev-missing'],
        },
        {
          code: 'PROGRAM_CONFLATION',
          explanation: 'Confunde programas.',
          evidenceIds: ['ev-2'],
        },
      ],
      verified,
    );
    expect(mechanisms).toHaveLength(1);
    expect(mechanisms[0]?.code).toBe('PROGRAM_CONFLATION');
  });

  it('does not invent mechanisms on SUPPORTED', () => {
    expect(
      mechanismsForVerdict('SUPPORTED', [
        {
          code: 'SELECTIVE_EVIDENCE',
          explanation: 'x',
          evidenceIds: ['ev-2'],
        },
      ]),
    ).toEqual([]);
  });

  it('validates MISLEADING with true component + mechanism, without intent', () => {
    const ok = validateMisleading(
      [SUPPORTS, REFUTES],
      ['O valor de R$ 600 existiu em 2022.'],
      [
        {
          code: 'OMITTED_TIME_LIMIT',
          explanation:
            'A vigência era temporal; não se presume intenção de mentir.',
          evidenceIds: ['ev-1', 'ev-2'],
        },
      ],
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.mechanisms[0]?.code).toBe('OMITTED_TIME_LIMIT');
      expect(ok.mechanisms[0]?.explanation).not.toMatch(/intenção deliberada/i);
    }

    const bad = validateMisleading([REFUTES], ['aspecto'], [
      {
        code: 'OMITTED_TIME_LIMIT',
        explanation: 'x',
        evidenceIds: ['ev-1'],
      },
    ]);
    expect(bad.ok).toBe(false);
  });

  it('allows multiple mechanisms when sustained by evidence', () => {
    const verified = new Map<string, Evidence>([
      ['ev-1', REFUTES],
      ['ev-2', SUPPORTS],
    ]);
    const mechanisms = sanitizeMechanisms(
      [
        {
          code: 'MISATTRIBUTED_AGGREGATE',
          explanation: 'Universo errado.',
          evidenceIds: ['ev-1'],
        },
        {
          code: 'SELECTIVE_PERIOD',
          explanation: 'Período seletivo.',
          evidenceIds: ['ev-2'],
        },
      ],
      verified,
    );
    expect(mechanisms).toHaveLength(2);
  });
});
