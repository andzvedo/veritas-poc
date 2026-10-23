import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactCheckResult, Verification } from '@veritas/shared';

import { useFactCheckStore } from '../factCheckStore';

const ACCESSED_AT = '2026-10-19T10:00:00-03:00';

const resetStore = () => {
  useFactCheckStore.getState().reset();
};

const makeVerification = (overrides: Partial<Verification> = {}): Verification => ({
  id: 'ver-1',
  sessionId: 'session-a',
  claimId: 'claim-1',
  segmentIds: ['seg-1'],
  originalQuote: 'Citação',
  normalizedClaim: 'Afirmação',
  transcriptConfirmed: true,
  atomicClaim: { id: 'atomic-1', proposition: 'Afirmação' },
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

const makeFactCheckResult = (seq: number, claim: string): FactCheckResult => ({
  data: {
    extractedClaim: claim,
    reasoningConfidence: 0.7,
    reasoning: `Análise de ${claim}`,
    flags: ['MISLEADING'],
    sources: ['https://example.com/source'],
  },
  meta: {
    fingerprint: 'fp-store',
    chunk: 0,
    seq,
  },
});

test('store upsertVerification ignores stale revisions and avoids duplicates', () => {
  resetStore();
  const store = useFactCheckStore.getState();

  store.upsertVerification(makeVerification({ revision: 1 }));
  store.upsertVerification(
    makeVerification({
      revision: 3,
      status: 'COMPLETED',
      verdict: 'INCONCLUSIVE',
      conclusion: 'Nova conclusão',
    }),
  );
  store.upsertVerification(makeVerification({ revision: 2, status: 'FAILED' }));
  store.upsertVerification(
    makeVerification({
      revision: 3,
      status: 'COMPLETED',
      verdict: 'FALSE',
      conclusion: 'Duplicata',
      contradiction: 'x',
    }),
  );

  const { verifications } = useFactCheckStore.getState();
  assert.equal(verifications.length, 1);
  assert.equal(verifications[0].revision, 3);
  assert.equal(verifications[0].conclusion, 'Nova conclusão');
});

test('store upsertFactCheckResult bridges claims and ignores duplicate ids', () => {
  resetStore();
  const store = useFactCheckStore.getState();

  store.upsertFactCheckResult(makeFactCheckResult(0, 'Claim A'));
  store.upsertFactCheckResult(makeFactCheckResult(0, 'Claim A duplicate'));
  store.upsertFactCheckResult(makeFactCheckResult(1, 'Claim B'));

  const state = useFactCheckStore.getState();
  assert.equal(state.results.length, 2);
  assert.equal(state.verifications.length, 2);
  assert.equal(state.results[0].data.extractedClaim, 'Claim A');
  assert.equal(state.verifications[0].verdict, 'MISLEADING');
  assert.equal(state.verifications[1].normalizedClaim, 'Claim B');
});

test('store invalidateVerification clears conclusive fields', () => {
  resetStore();
  const store = useFactCheckStore.getState();
  store.upsertVerification(
    makeVerification({
      revision: 1,
      status: 'COMPLETED',
      verdict: 'FALSE',
      conclusion: 'Era falsa',
      contradiction: 'Contradição',
    }),
  );

  store.invalidateVerification({
    verificationId: 'ver-1',
    reason: 'Correção de fala',
    revision: 2,
  });

  const card = useFactCheckStore.getState().verifications[0];
  assert.equal(card.status, 'CANCELLED');
  assert.equal(card.verdict, undefined);
  assert.equal(card.conclusion, undefined);
});

test('rememberEventId dedupes reconnect replays', () => {
  resetStore();
  const store = useFactCheckStore.getState();
  assert.equal(store.rememberEventId('evt-1'), true);
  assert.equal(useFactCheckStore.getState().rememberEventId('evt-1'), false);
  assert.equal(useFactCheckStore.getState().rememberEventId('evt-2'), true);
});

test('applySessionSnapshot ignores other sessions', () => {
  resetStore();
  useFactCheckStore.getState().update({ sessionId: 'session-a' });
  useFactCheckStore.getState().upsertVerification(makeVerification({ revision: 1 }));

  useFactCheckStore.getState().applySessionSnapshot({
    sessionId: 'session-b',
    state: 'LISTENING',
    segments: [],
    claims: [],
    verifications: [
      makeVerification({
        id: 'other',
        sessionId: 'session-b',
        revision: 9,
      }),
    ],
    cursor: 99,
  });

  const state = useFactCheckStore.getState();
  assert.equal(state.verifications.length, 1);
  assert.equal(state.verifications[0].id, 'ver-1');
  assert.equal(state.eventCursor, 0);
});
