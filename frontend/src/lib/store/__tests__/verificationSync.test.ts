import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactCheckResult, Verification } from '@veritas/shared';

import {
  applySessionSnapshotVerifications,
  applyVerificationInvalidation,
  factCheckResultId,
  factCheckResultToVerification,
  mapFactCheckFlagsToVerdict,
  selectDisplayVerifications,
  upsertByRevision,
} from '../verificationSync';

const ACCESSED_AT = '2026-10-19T10:00:00-03:00';

const baseVerification = (
  overrides: Partial<Verification> = {},
): Verification => ({
  id: 'ver-1',
  sessionId: 'session-a',
  claimId: 'claim-1',
  segmentIds: ['seg-1'],
  originalQuote: 'Citação original',
  normalizedClaim: 'Afirmação normalizada',
  transcriptConfirmed: true,
  atomicClaim: {
    id: 'atomic-1',
    proposition: 'Afirmação normalizada',
  },
  status: 'RESEARCHING',
  mechanisms: [],
  supportedAspects: [],
  limitations: [],
  evidence: [],
  sources: [],
  revision: 1,
  createdAt: ACCESSED_AT,
  updatedAt: ACCESSED_AT,
  ...overrides,
});

const baseFactCheckResult = (
  overrides: Partial<FactCheckResult> = {},
): FactCheckResult => ({
  data: {
    extractedClaim: 'O Brasil tem 215 milhões de habitantes.',
    reasoningConfidence: 0.8,
    reasoning: 'Há dados oficiais próximos desse número.',
    flags: undefined,
    sources: ['https://www.ibge.gov.br/'],
  },
  meta: {
    fingerprint: 'fp-1',
    chunk: 0,
    seq: 0,
  },
  ...overrides,
});

test('upsertByRevision inserts a new id', () => {
  const result = upsertByRevision([], baseVerification());
  assert.equal(result.applied, true);
  assert.equal(result.reason, 'inserted');
  assert.equal(result.items.length, 1);
});

test('upsertByRevision updates when revision is higher', () => {
  const first = baseVerification({ revision: 1, status: 'RESEARCHING' });
  const second = baseVerification({
    revision: 2,
    status: 'COMPLETED',
    verdict: 'INCONCLUSIVE',
    conclusion: 'Faltou evidência decisiva.',
  });

  const inserted = upsertByRevision([], first);
  const updated = upsertByRevision(inserted.items, second);

  assert.equal(updated.applied, true);
  assert.equal(updated.reason, 'updated');
  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0].revision, 2);
  assert.equal(updated.items[0].status, 'COMPLETED');
});

test('upsertByRevision ignores stale and duplicate revisions', () => {
  const current = baseVerification({ revision: 3 });
  const stale = baseVerification({ revision: 2, status: 'FAILED' });
  const duplicate = baseVerification({ revision: 3, status: 'CANCELLED' });

  const afterStale = upsertByRevision([current], stale);
  assert.equal(afterStale.applied, false);
  assert.equal(afterStale.reason, 'stale');
  assert.equal(afterStale.items[0].status, 'RESEARCHING');

  const afterDup = upsertByRevision([current], duplicate);
  assert.equal(afterDup.applied, false);
  assert.equal(afterDup.reason, 'duplicate');
});

test('upsertByRevision ignores events from another session', () => {
  const result = upsertByRevision(
    [baseVerification()],
    baseVerification({
      id: 'ver-2',
      sessionId: 'session-b',
      revision: 1,
    }),
    'session-a',
  );

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'wrong-session');
  assert.equal(result.items.length, 1);
});

test('applyVerificationInvalidation supersedes without inventing a verdict', () => {
  const completed = baseVerification({
    status: 'COMPLETED',
    verdict: 'FALSE',
    conclusion: 'Conclusão antiga',
    contradiction: 'Contradição antiga',
    revision: 2,
  });

  const result = applyVerificationInvalidation([completed], {
    verificationId: 'ver-1',
    reason: 'Transcrição corrigida',
    revision: 3,
  });

  assert.equal(result.applied, true);
  assert.equal(result.items[0].status, 'CANCELLED');
  assert.equal(result.items[0].verdict, undefined);
  assert.equal(result.items[0].conclusion, undefined);
  assert.equal(result.items[0].contradiction, undefined);
  assert.ok(result.items[0].limitations.some((item) => item.includes('corrigida')));
});

test('applyVerificationInvalidation ignores stale revision', () => {
  const current = baseVerification({ revision: 5, status: 'COMPLETED', verdict: 'INCONCLUSIVE', conclusion: 'ok' });
  const result = applyVerificationInvalidation([current], {
    verificationId: 'ver-1',
    reason: 'old',
    revision: 4,
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'stale');
  assert.equal(result.items[0].status, 'COMPLETED');
});

test('applySessionSnapshotVerifications upserts by revision and returns cursor', () => {
  const existing = baseVerification({ revision: 1, status: 'RESEARCHING' });
  const snapshotItem = baseVerification({
    revision: 4,
    status: 'COMPLETED',
    verdict: 'INCONCLUSIVE',
    conclusion: 'Snapshot mais recente',
  });

  const merged = applySessionSnapshotVerifications([existing], {
    sessionId: 'session-a',
    state: 'LISTENING',
    segments: [],
    claims: [],
    verifications: [snapshotItem],
    cursor: 42,
  });

  assert.equal(merged.cursor, 42);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].revision, 4);
  assert.equal(merged.items[0].conclusion, 'Snapshot mais recente');
});

test('authoritative empty snapshot removes stale cards but preserves invalidation tombstones', () => {
  const stale = baseVerification({ status: 'COMPLETED', verdict: 'SUPPORTED' });
  const tombstone = baseVerification({
    id: 'ver-invalidated',
    status: 'CANCELLED',
    verdict: undefined,
    revision: 3,
  });
  const merged = applySessionSnapshotVerifications([stale, tombstone], {
    sessionId: 'session-a',
    state: 'LISTENING',
    segments: [],
    claims: [],
    verifications: [],
    cursor: 44,
  });

  assert.deepEqual(merged.items.map((item) => item.id), ['ver-invalidated']);
});

test('mapFactCheckFlagsToVerdict never treats absent flags as SUPPORTED/FALSE', () => {
  assert.equal(mapFactCheckFlagsToVerdict(undefined), 'INCONCLUSIVE');
  assert.equal(mapFactCheckFlagsToVerdict([]), 'INCONCLUSIVE');
  assert.equal(mapFactCheckFlagsToVerdict(['MISLEADING']), 'MISLEADING');
  assert.equal(mapFactCheckFlagsToVerdict(['INCONCLUSIVE']), 'INCONCLUSIVE');
  assert.equal(mapFactCheckFlagsToVerdict(['UNVERIFIABLE']), 'INCONCLUSIVE');
  assert.equal(mapFactCheckFlagsToVerdict(['AMBIGUOUS']), 'INCONCLUSIVE');
});

test('factCheckResultToVerification bridges text mode without inventing SUPPORTED', () => {
  const bridged = factCheckResultToVerification(baseFactCheckResult());
  assert.equal(bridged.id, factCheckResultId(baseFactCheckResult()));
  assert.equal(bridged.status, 'COMPLETED');
  assert.equal(bridged.verdict, 'INCONCLUSIVE');
  assert.ok(
    bridged.limitations.some((item) =>
      item.includes('não é inferido pela ausência de flags'),
    ),
  );
});

test('factCheckResultToVerification prefers structured data.verification from LIVE-016/017', () => {
  const structured = baseVerification({
    id: 'pipeline-ver-9',
    revision: 4,
    status: 'COMPLETED',
    verdict: 'SUPPORTED',
    conclusion: 'Sustentada pelo pipeline de evidências.',
    evidence: [
      {
        id: 'ev-1',
        sourceId: 'src-1',
        relation: 'SUPPORTS',
        claimIds: ['atomic-1'],
        excerpt: 'Trecho',
        explanation: 'Apoia',
        verifiedContent: true,
      },
    ],
    sources: [
      {
        id: 'src-1',
        title: 'Fonte',
        publisher: 'example.org',
        url: 'https://example.org/doc',
        type: 'PRIMARY',
        accessedAt: ACCESSED_AT,
      },
    ],
  });

  const result: FactCheckResult = {
    data: {
      extractedClaim: 'Ignorar este texto legado',
      reasoningConfidence: 0.1,
      reasoning: 'Projeção legada',
      flags: ['INCONCLUSIVE'],
      sources: ['https://example.org/legacy'],
      verification: structured,
      resultVersion: 1,
    },
    meta: { fingerprint: 'fp-1', chunk: 0, seq: 0 },
  };

  const bridged = factCheckResultToVerification(result, { sessionId: 'session-a' });
  assert.equal(factCheckResultId(result), 'pipeline-ver-9');
  assert.equal(bridged.id, 'pipeline-ver-9');
  assert.equal(bridged.verdict, 'SUPPORTED');
  assert.equal(bridged.revision, 4);
  assert.equal(bridged.conclusion, 'Sustentada pelo pipeline de evidências.');
  assert.equal(bridged.sessionId, 'session-a');
});

test('selectDisplayVerifications prefers live list over legacy bridge', () => {
  const live = [baseVerification({ id: 'live-1', revision: 1 })];
  const legacy = [baseFactCheckResult()];

  const preferred = selectDisplayVerifications(live, legacy);
  assert.equal(preferred.length, 1);
  assert.equal(preferred[0].id, 'live-1');

  const bridged = selectDisplayVerifications([], legacy);
  assert.equal(bridged.length, 1);
  assert.equal(bridged[0].id, 'fp-1-0-0');
});

test('repeated upserts of the same revision never duplicate cards', () => {
  let items: Verification[] = [];
  const card = baseVerification({ revision: 2 });

  for (let i = 0; i < 5; i += 1) {
    items = upsertByRevision(items, card).items;
  }

  assert.equal(items.length, 1);
});

test('applySessionSnapshotVerifications replays invalidations without resurrecting an old verdict (LIVE-040)', () => {
  const stale = baseVerification({
    revision: 3,
    status: 'COMPLETED',
    verdict: 'FALSE',
    conclusion: 'Conclusão da versão antiga',
  });
  const invalidatedAt = '2026-10-23T12:00:00-03:00';

  const merged = applySessionSnapshotVerifications([stale], {
    sessionId: 'session-a',
    state: 'LISTENING',
    segments: [],
    claims: [],
    // The server no longer lists the superseded verification as current.
    verifications: [],
    cursor: 50,
    invalidations: [
      {
        verificationId: 'ver-1',
        claimId: 'claim-1',
        revision: 5,
        cause: 'TRANSCRIPT_CORRECTION',
        reason: 'Transcrição corrigida pelo usuário',
        invalidatedAt,
      },
    ],
  });

  assert.equal(merged.items.length, 1);
  const card = merged.items[0];
  assert.equal(card.status, 'CANCELLED');
  assert.equal(card.verdict, undefined);
  assert.equal(card.conclusion, undefined);
  assert.equal(card.revision, 5);
  assert.equal(card.updatedAt, invalidatedAt);
});

test('applySessionSnapshotVerifications keeps a newer result over an older invalidation (LIVE-040)', () => {
  const fresh = baseVerification({
    revision: 7,
    status: 'COMPLETED',
    verdict: 'SUPPORTED',
    conclusion: 'Nova tentativa concluída',
  });

  const merged = applySessionSnapshotVerifications([], {
    sessionId: 'session-a',
    state: 'LISTENING',
    segments: [],
    claims: [],
    verifications: [fresh],
    cursor: 60,
    invalidations: [
      {
        verificationId: 'ver-1',
        claimId: 'claim-1',
        revision: 5,
        cause: 'RETRY_REQUESTED',
        reason: 'Nova tentativa solicitada pelo usuário',
        invalidatedAt: '2026-10-23T12:00:00-03:00',
      },
    ],
  });

  assert.equal(merged.items[0].status, 'COMPLETED');
  assert.equal(merged.items[0].verdict, 'SUPPORTED');
  assert.equal(merged.items[0].revision, 7);
});
