import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type {
  ClaimStatus,
  Evidence,
  Mechanism,
  MechanismCode,
  Source,
  Verification,
  Verdict,
} from '@veritas/shared';

import {
  countUniqueSources,
  deriveContradiction,
  deriveWhatFound,
  deriveWhatSaid,
  EVIDENCE_RELATION_LABELS,
  formatIsoDate,
  formatTimestamp,
  getContextEvidence,
  getDisplayVerdict,
  getEvidenceRelationLabel,
  getLimitations,
  getMechanismEvidence,
  getMechanismLabel,
  getPrimarySources,
  getRefutingEvidence,
  getSpeakerLabel,
  getStatusLabel,
  getSupportingEvidence,
  getSupportedAspects,
  getUniqueSources,
  getUnverifiedEvidence,
  getVerdictLabel,
  isDefinitive,
  MECHANISM_LABELS,
  resolveEvidence,
  sortSources,
  STATUS_LABELS,
  VERDICT_LABELS,
} from '../presentation';

const ACCESSED_AT = '2026-10-19T10:00:00-03:00';

const ALL_STATUSES: ClaimStatus[] = [
  'DETECTED',
  'QUEUED',
  'RESEARCHING',
  'EVALUATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'DEFERRED',
  'BLOCKED',
];

const ALL_VERDICTS: Verdict[] = ['SUPPORTED', 'FALSE', 'MISLEADING', 'INCONCLUSIVE'];

const ALL_MECHANISMS: MechanismCode[] = [
  'FALSE_ORIGIN_ATTRIBUTION',
  'MISATTRIBUTED_AGGREGATE',
  'OMITTED_TIME_LIMIT',
  'PROGRAM_CONFLATION',
  'INCOMPATIBLE_COMPARISON',
  'UNSUPPORTED_CAUSALITY',
  'SELECTIVE_PERIOD',
  'OVERGENERALIZATION',
  'SELECTIVE_EVIDENCE',
];

const makeSource = (
  overrides: Pick<Source, 'id' | 'title' | 'publisher' | 'url'> & Partial<Source>,
): Source => ({
  type: 'SECONDARY',
  accessedAt: ACCESSED_AT,
  ...overrides,
});

const makeEvidence = (
  overrides: Pick<Evidence, 'id' | 'sourceId'> & Partial<Evidence>,
): Evidence => ({
  relation: 'SUPPORTS',
  claimIds: ['claim-1'],
  verifiedContent: true,
  excerpt: 'Trecho inspecionado do documento.',
  explanation: 'O trecho se relaciona com a fala verificada.',
  ...overrides,
});

const baseVerification = (): Verification => ({
  id: 'verification-1',
  claimId: 'claim-1',
  segmentIds: ['segment-1'],
  speakerId: 'speaker-1',
  originalQuote: '  O nosso governo teve a ideia de criar o Pix.  ',
  normalizedClaim: 'O governo Bolsonaro criou o Pix.',
  timestampMs: { start: 65_000, end: 71_000 },
  transcriptConfirmed: true,
  atomicClaim: {
    id: 'atomic-1',
    proposition: 'O governo Bolsonaro criou o Pix.',
  },
  status: 'COMPLETED',
  verdict: 'FALSE',
  conclusion: 'A iniciativa já estava documentada antes do governo citado.',
  contradiction:
    'Os requisitos fundamentais do Pix foram definidos em dezembro de 2018.',
  contradictionEvidenceIds: ['evidence-1'],
  mechanisms: [],
  supportedAspects: [],
  limitations: [],
  evidence: [
    makeEvidence({
      id: 'evidence-1',
      sourceId: 'source-1',
      relation: 'REFUTES',
      excerpt: 'Requisitos fundamentais aprovados em 21/12/2018.',
      location: 'p. 4',
      explanation: 'O documento antecede a posse citada na fala.',
    }),
  ],
  sources: [
    makeSource({
      id: 'source-1',
      title: 'Requisitos fundamentais do Pix',
      publisher: 'Banco Central do Brasil',
      url: 'https://www.bcb.gov.br/requisitos',
      type: 'PRIMARY',
      publishedAt: '2018-12-21T09:00:00-02:00',
    }),
    makeSource({
      id: 'source-2',
      title: 'Checagem da entrevista',
      publisher: 'Agência Lupa',
      url: 'https://www.agencialupa.org/checagem',
      publishedAt: '2022-09-14T12:00:00-03:00',
    }),
  ],
  revision: 1,
  reviewedBy: 'AUTOMATED',
  createdAt: '2026-10-18T20:00:00-03:00',
  updatedAt: '2026-10-18T20:01:00-03:00',
});

const makeVerification = (overrides: Partial<Verification> = {}): Verification => ({
  ...baseVerification(),
  ...overrides,
});

test('getStatusLabel covers every operational status', () => {
  assert.equal(getStatusLabel('DETECTED'), 'Detectada');
  assert.equal(getStatusLabel('QUEUED'), 'Na fila');
  assert.equal(getStatusLabel('RESEARCHING'), 'Buscando fontes');
  assert.equal(getStatusLabel('EVALUATING'), 'Avaliando evidências');
  assert.equal(getStatusLabel('COMPLETED'), 'Concluída');
  assert.equal(getStatusLabel('FAILED'), 'Falha técnica');
  assert.equal(getStatusLabel('CANCELLED'), 'Cancelada');
  assert.equal(getStatusLabel('DEFERRED'), 'Adiada');
  assert.equal(getStatusLabel('BLOCKED'), 'Bloqueada');

  assert.equal(Object.keys(STATUS_LABELS).length, ALL_STATUSES.length);
  for (const status of ALL_STATUSES) {
    assert.ok(getStatusLabel(status).length > 0);
  }
});

test('getVerdictLabel uses the editorial PT-BR taxonomy', () => {
  assert.equal(getVerdictLabel('SUPPORTED'), 'Sustentada');
  assert.equal(getVerdictLabel('FALSE'), 'Falsa');
  assert.equal(getVerdictLabel('MISLEADING'), 'Enganosa');
  assert.equal(getVerdictLabel('INCONCLUSIVE'), 'Inconclusiva');
  assert.equal(Object.keys(VERDICT_LABELS).length, ALL_VERDICTS.length);
});

test('getMechanismLabel covers all nine mechanism codes', () => {
  assert.equal(
    getMechanismLabel('FALSE_ORIGIN_ATTRIBUTION'),
    'Falsa atribuição de origem ou autoria',
  );
  assert.equal(
    getMechanismLabel('MISATTRIBUTED_AGGREGATE'),
    'Dado agregado atribuído ao universo errado',
  );
  assert.equal(getMechanismLabel('OMITTED_TIME_LIMIT'), 'Omissão de duração ou prazo');
  assert.equal(
    getMechanismLabel('PROGRAM_CONFLATION'),
    'Confusão entre programas ou instituições',
  );
  assert.equal(
    getMechanismLabel('INCOMPATIBLE_COMPARISON'),
    'Comparação de métricas incompatíveis',
  );
  assert.equal(
    getMechanismLabel('UNSUPPORTED_CAUSALITY'),
    'Causalidade não demonstrada',
  );
  assert.equal(getMechanismLabel('SELECTIVE_PERIOD'), 'Recorte temporal seletivo');
  assert.equal(getMechanismLabel('OVERGENERALIZATION'), 'Generalização indevida');
  assert.equal(
    getMechanismLabel('SELECTIVE_EVIDENCE'),
    'Seleção parcial de evidências',
  );

  assert.equal(Object.keys(MECHANISM_LABELS).length, ALL_MECHANISMS.length);
  for (const code of ALL_MECHANISMS) {
    assert.ok(getMechanismLabel(code).length > 0);
  }
});

test('getEvidenceRelationLabel maps the three contract relations', () => {
  assert.equal(getEvidenceRelationLabel('SUPPORTS'), 'Sustenta');
  assert.equal(getEvidenceRelationLabel('REFUTES'), 'Contradiz');
  assert.equal(getEvidenceRelationLabel('CONTEXTUALIZES'), 'Contextualiza');
  assert.equal(Object.keys(EVIDENCE_RELATION_LABELS).length, 3);
});

test('isDefinitive and getDisplayVerdict never expose an in-flight verdict', () => {
  assert.equal(isDefinitive(makeVerification()), true);
  assert.equal(getDisplayVerdict(makeVerification()), 'FALSE');

  const inFlight = makeVerification({ status: 'RESEARCHING', verdict: 'FALSE' });
  assert.equal(isDefinitive(inFlight), false);
  assert.equal(getDisplayVerdict(inFlight), null);

  const completedWithoutVerdict = makeVerification({ verdict: undefined });
  assert.equal(isDefinitive(completedWithoutVerdict), false);
  assert.equal(getDisplayVerdict(completedWithoutVerdict), null);

  for (const status of ALL_STATUSES.filter((item) => item !== 'COMPLETED')) {
    const pending = makeVerification({ status, verdict: 'MISLEADING' });
    assert.equal(isDefinitive(pending), false, status);
    assert.equal(getDisplayVerdict(pending), null, status);
  }
});

test('deriveWhatSaid returns the literal quote and never invents one', () => {
  assert.equal(
    deriveWhatSaid(makeVerification()),
    'O nosso governo teve a ideia de criar o Pix.',
  );
  assert.equal(deriveWhatSaid(makeVerification({ originalQuote: '   ' })), null);
});

test('deriveWhatFound follows the verdict-specific sources', () => {
  assert.equal(
    deriveWhatFound(makeVerification({ verdict: 'FALSE' })),
    'Os requisitos fundamentais do Pix foram definidos em dezembro de 2018.',
  );

  assert.equal(
    deriveWhatFound(makeVerification({ verdict: 'SUPPORTED' })),
    'A iniciativa já estava documentada antes do governo citado.',
  );

  assert.equal(
    deriveWhatFound(
      makeVerification({
        verdict: 'MISLEADING',
        supportedAspects: ['O valor de R$ 600 foi pago em 2022.', 'Era temporário.'],
        conclusion: 'O aumento existiu, mas não era permanente.',
      }),
    ),
    'O valor de R$ 600 foi pago em 2022. Era temporário.',
  );

  assert.equal(
    deriveWhatFound(
      makeVerification({
        verdict: 'INCONCLUSIVE',
        limitations: ['Faltou a série completa.', 'Faltou o recorte por órgão.'],
        conclusion: 'Não foi possível confirmar o total atribuído.',
      }),
    ),
    'Faltou a série completa. Faltou o recorte por órgão.',
  );
});

test('deriveWhatFound falls back to documented text, never to a new claim', () => {
  assert.equal(
    deriveWhatFound(makeVerification({ verdict: 'FALSE', contradiction: '   ' })),
    'A iniciativa já estava documentada antes do governo citado.',
  );

  assert.equal(
    deriveWhatFound(
      makeVerification({
        verdict: 'MISLEADING',
        supportedAspects: [],
        conclusion: 'O aumento existiu, mas não era permanente.',
      }),
    ),
    'O aumento existiu, mas não era permanente.',
  );

  assert.equal(
    deriveWhatFound(
      makeVerification({
        verdict: 'INCONCLUSIVE',
        limitations: ['  '],
        conclusion: 'Não foi possível confirmar o total atribuído.',
      }),
    ),
    'Não foi possível confirmar o total atribuído.',
  );

  const pending = makeVerification({
    status: 'EVALUATING',
    verdict: 'FALSE',
    contradiction: 'Contradição que ainda não é vigente.',
  });
  assert.equal(deriveWhatFound(pending), null);
  assert.equal(deriveContradiction(pending), null);
});

test('deriveContradiction only exists for a completed FALSE result', () => {
  assert.equal(
    deriveContradiction(makeVerification()),
    'Os requisitos fundamentais do Pix foram definidos em dezembro de 2018.',
  );
  assert.equal(deriveContradiction(makeVerification({ verdict: 'MISLEADING' })), null);
  assert.equal(
    deriveContradiction(makeVerification({ status: 'BLOCKED', verdict: 'FALSE' })),
    null,
  );
});

test('getSupportedAspects, getLimitations and getSpeakerLabel trim and drop blanks', () => {
  const verification = makeVerification({
    supportedAspects: ['  O pagamento ocorreu.  ', '   '],
    limitations: ['  Faltou o dado de 2023.'],
    speakerId: '  speaker-7  ',
  });

  assert.deepEqual(getSupportedAspects(verification), ['O pagamento ocorreu.']);
  assert.deepEqual(getLimitations(verification), ['Faltou o dado de 2023.']);
  assert.equal(getSpeakerLabel(verification), 'speaker-7');
  assert.equal(
    getSpeakerLabel(verification, [
      {
        speakerId: 'speaker-7',
        participantName: 'Candidata A',
        confirmed: true,
        revision: 1,
      },
    ]),
    'Candidata A',
  );
  assert.equal(
    getSpeakerLabel(verification, [
      {
        speakerId: 'speaker-7',
        participantName: 'Candidata A',
        confirmed: false,
        revision: 1,
      },
    ]),
    'speaker-7',
  );
  assert.equal(getSpeakerLabel(makeVerification({ speakerId: undefined })), null);
});

test('evidence with a dangling source reference is dropped', () => {
  const verification = makeVerification({
    evidence: [
      makeEvidence({ id: 'evidence-1', sourceId: 'source-1', relation: 'REFUTES' }),
      makeEvidence({ id: 'evidence-2', sourceId: 'source-404', relation: 'REFUTES' }),
    ],
  });

  const resolved = resolveEvidence(verification);
  assert.deepEqual(
    resolved.map((item) => item.evidence.id),
    ['evidence-1'],
  );
  assert.deepEqual(getRefutingEvidence(verification).map((item) => item.evidence.id), [
    'evidence-1',
  ]);
  assert.equal(countUniqueSources(getRefutingEvidence(verification)), 1);
});

test('mechanism evidence references resolve and drop dangling ids', () => {
  const mechanism: Mechanism = {
    code: 'FALSE_ORIGIN_ATTRIBUTION',
    explanation: 'A iniciativa antecede o governo citado.',
    evidenceIds: ['evidence-1', 'evidence-404'],
  };
  const verification = makeVerification({ mechanisms: [mechanism] });

  const linked = getMechanismEvidence(verification, mechanism);
  assert.deepEqual(linked.map((item) => item.evidence.id), ['evidence-1']);
  assert.equal(linked[0]?.source.publisher, 'Banco Central do Brasil');
});

test('evidence is grouped by relation and unverified items are never proof', () => {
  const verification = makeVerification({
    evidence: [
      makeEvidence({ id: 'evidence-1', sourceId: 'source-1', relation: 'SUPPORTS' }),
      makeEvidence({ id: 'evidence-2', sourceId: 'source-2', relation: 'REFUTES' }),
      makeEvidence({
        id: 'evidence-3',
        sourceId: 'source-2',
        relation: 'CONTEXTUALIZES',
      }),
      makeEvidence({
        id: 'evidence-4',
        sourceId: 'source-1',
        relation: 'SUPPORTS',
        verifiedContent: false,
      }),
    ],
  });

  assert.deepEqual(getSupportingEvidence(verification).map((i) => i.evidence.id), [
    'evidence-1',
  ]);
  assert.deepEqual(getRefutingEvidence(verification).map((i) => i.evidence.id), [
    'evidence-2',
  ]);
  assert.deepEqual(getContextEvidence(verification).map((i) => i.evidence.id), [
    'evidence-3',
  ]);
  assert.deepEqual(getUnverifiedEvidence(verification).map((i) => i.evidence.id), [
    'evidence-4',
  ]);
});

test('duplicate URLs are counted once, not as independent sources', () => {
  const verification = makeVerification({
    sources: [
      makeSource({
        id: 'source-1',
        title: 'Checagem A',
        publisher: 'Agência Lupa',
        url: 'https://example.org/a',
      }),
      makeSource({
        id: 'source-2',
        title: 'Checagem A (reproduzida)',
        publisher: 'Agência Lupa',
        url: 'https://example.org/a',
      }),
    ],
    evidence: [
      makeEvidence({ id: 'evidence-1', sourceId: 'source-1', relation: 'REFUTES' }),
      makeEvidence({ id: 'evidence-2', sourceId: 'source-2', relation: 'REFUTES' }),
    ],
  });

  assert.equal(getUniqueSources(verification.sources).length, 1);
  assert.equal(countUniqueSources(getRefutingEvidence(verification)), 1);
  assert.equal(countUniqueSources(resolveEvidence(verification)), 1);
});

test('getPrimarySources keeps only primary documents, sorted and unique', () => {
  const verification = makeVerification({
    sources: [
      makeSource({
        id: 'source-3',
        title: 'Zeta',
        publisher: 'Zeta Editora',
        url: 'https://example.org/z',
        type: 'PRIMARY',
      }),
      makeSource({
        id: 'source-1',
        title: 'Alfa',
        publisher: 'Alfa Editora',
        url: 'https://example.org/a',
        type: 'PRIMARY',
      }),
      makeSource({
        id: 'source-2',
        title: 'Notícia',
        publisher: 'Jornal',
        url: 'https://example.org/n',
        type: 'SECONDARY',
      }),
      makeSource({
        id: 'source-4',
        title: 'Alfa repetida',
        publisher: 'Alfa Editora',
        url: 'https://example.org/a',
        type: 'PRIMARY',
      }),
    ],
  });

  assert.deepEqual(
    getPrimarySources(verification).map((source) => source.id),
    ['source-1', 'source-3'],
  );
});

test('sortSources is deterministic regardless of input order', () => {
  const sources = [
    makeSource({
      id: 'b',
      title: 'Beta',
      publisher: 'Banco Central',
      url: 'https://example.org/b',
    }),
    makeSource({
      id: 'a',
      title: 'Alfa',
      publisher: 'Agência Lupa',
      url: 'https://example.org/a',
    }),
    makeSource({
      id: 'c',
      title: 'Alfa',
      publisher: 'Agência Lupa',
      url: 'https://example.org/c',
    }),
  ];

  const forward = sortSources(sources).map((source) => source.id);
  const backward = sortSources([...sources].reverse()).map((source) => source.id);

  assert.deepEqual(forward, ['a', 'c', 'b']);
  assert.deepEqual(backward, forward);
  assert.deepEqual(
    sources.map((source) => source.id),
    ['b', 'a', 'c'],
    'sortSources must not mutate its input',
  );
});

test('formatTimestamp renders media time as mm:ss', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(5_000), '00:05');
  assert.equal(formatTimestamp(65_000), '01:05');
  assert.equal(formatTimestamp(3_599_000), '59:59');
  assert.equal(formatTimestamp(3_600_000), '60:00');
  assert.equal(formatTimestamp(65_999), '01:05');
  assert.equal(formatTimestamp(-1), '00:00');
  assert.equal(formatTimestamp(Number.NaN), '00:00');
  assert.equal(formatTimestamp(undefined), '00:00');
  assert.equal(formatTimestamp(null), '00:00');
});

test('formatIsoDate keeps the calendar date and never throws', () => {
  assert.equal(formatIsoDate('2018-12-21T09:00:00-02:00'), '21/12/2018');
  assert.equal(formatIsoDate('2026-10-18T23:30:00-03:00'), '18/10/2026');
  assert.equal(formatIsoDate('2026-10-18'), '18/10/2026');
  assert.equal(formatIsoDate('2026-02-30T10:00:00-03:00'), null);
  assert.equal(formatIsoDate('not-a-date'), null);
  assert.equal(formatIsoDate('   '), null);
  assert.equal(formatIsoDate(undefined), null);
  assert.equal(formatIsoDate(null), null);
});

type LocaleFile = { liveCard: Record<string, unknown> };

const readLocale = (name: string): LocaleFile =>
  JSON.parse(
    readFileSync(new URL(`../../i18n/locales/${name}.json`, import.meta.url), 'utf8'),
  ) as LocaleFile;

const collectKeyPaths = (value: unknown, prefix = ''): string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeyPaths(child, prefix.length > 0 ? `${prefix}.${key}` : key),
  );
};

test('liveCard translations exist in every locale and mirror the contract enums', () => {
  const pt = readLocale('pt-BR');
  const en = readLocale('en-US');

  assert.deepEqual(
    collectKeyPaths(pt.liveCard).sort(),
    collectKeyPaths(en.liveCard).sort(),
  );

  const statuses = Object.keys(pt.liveCard.status as Record<string, string>);
  assert.deepEqual([...statuses].sort(), [...ALL_STATUSES].sort());

  const verdicts = Object.keys(pt.liveCard.verdict as Record<string, string>);
  assert.deepEqual([...verdicts].sort(), [...ALL_VERDICTS].sort());

  const mechanisms = Object.keys(pt.liveCard.mechanisms as Record<string, string>);
  assert.deepEqual([...mechanisms].sort(), [...ALL_MECHANISMS].sort());

  const notices = pt.liveCard.notices as Record<string, { title: string; body: string }>;
  for (const status of ALL_STATUSES.filter((item) => item !== 'COMPLETED')) {
    assert.ok(notices[status]?.title.length, `missing notice title for ${status}`);
    assert.ok(notices[status]?.body.length, `missing notice body for ${status}`);
  }
});
