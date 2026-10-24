import { describe, expect, it } from 'vitest';
import {
  RevisionConflictError,
  RevisionLedger,
  classifyTextChange,
  isTypographicOnly,
} from '#/live/revisionLedger.js';
import { ClaimQueue, QueueCancelledError } from '#/live/claimQueue.js';

const INPUTS = {
  claimRef: { id: 'claim-1', revision: 0 },
  segmentRefs: [{ id: 'seg-1', revision: 1 }],
  contextRefs: [],
  speakerMappingRevision: 0,
};

describe('classifyTextChange (LIVE-040 typographic decision)', () => {
  it.each([
    ['O Pix foi criado em 2020.', 'o pix foi criado em 2020', ['TYPOGRAPHIC']],
    ['Pix,  criado   em 2020!', 'Pix criado em 2020', ['TYPOGRAPHIC']],
  ])('keeps case/spacing/punctuation-only edits: %s', (before, after, kinds) => {
    expect(classifyTextChange(before, after)).toEqual(kinds);
    expect(isTypographicOnly(classifyTextChange(before, after))).toBe(true);
  });

  it('treats any number change as NUMBER, including separators inside numbers', () => {
    expect(classifyTextChange('Foram 2020 casos', 'Foram 2021 casos')).toContain('NUMBER');
    expect(classifyTextChange('Custou 1.000 reais', 'Custou 1,000 reais')).toContain('NUMBER');
    expect(classifyTextChange('Cresceu 3,5%', 'Cresceu 35%')).toContain('NUMBER');
    expect(classifyTextChange('Foram dez mil', 'Foram dez milhões')).toContain('NUMBER');
  });

  it('detects negation and wording changes', () => {
    expect(classifyTextChange('O Pix foi criado', 'O Pix não foi criado')).toEqual(['NEGATION']);
    expect(classifyTextChange('O Pix foi criado', 'O TED foi criado')).toEqual(['WORDING']);
  });
});

describe('RevisionLedger', () => {
  const at = new Date('2026-10-23T12:00:00.000Z');

  it('issues strictly increasing revisions and invalidations above the floor', () => {
    const ledger = new RevisionLedger({ now: () => at });
    expect(ledger.nextRevision('v', 3)).toBe(4);
    expect(ledger.nextRevision('v')).toBe(5);
    const invalidation = ledger.invalidate({
      verificationId: 'v',
      claimId: 'claim-1',
      cause: 'RETRY_REQUESTED',
      reason: 'retry',
      floorRevision: 2,
    });
    expect(invalidation.revision).toBe(6);
    expect(ledger.nextRevision('v', 0)).toBe(7);
  });

  it('only the current attempt may publish; invalidation cancels a running one', () => {
    const ledger = new RevisionLedger({ now: () => at });
    const first = ledger.startAttempt({ verificationId: 'v', claimId: 'claim-1', inputs: INPUTS });
    const second = ledger.startAttempt({ verificationId: 'v', claimId: 'claim-1', inputs: INPUTS });
    expect(ledger.isCurrentAttempt('v', first.id)).toBe(false);
    expect(ledger.getAttempt(first.id)?.status).toBe('SUPERSEDED');
    expect(ledger.isCurrentAttempt('v', second.id)).toBe(true);
    ledger.invalidate({ verificationId: 'v', claimId: 'claim-1', cause: 'CONTEXT_CHANGED', reason: 'ctx' });
    expect(ledger.isCurrentAttempt('v', second.id)).toBe(false);
    expect(ledger.getAttempt(second.id)?.status).toBe('CANCELLED');
    expect(ledger.getAttempt(second.id)?.inputs).toEqual(INPUTS);
  });

  it('rejects human review on a stale or missing revision and keeps it separate', () => {
    const ledger = new RevisionLedger({ now: () => at });
    expect(() =>
      ledger.addHumanReview({ verificationId: 'v', currentRevision: undefined, expectedRevision: 0, decision: 'NOTE' }),
    ).toThrow(RevisionConflictError);
    expect(() =>
      ledger.addHumanReview({ verificationId: 'v', currentRevision: 3, expectedRevision: 2, decision: 'CONFIRMED' }),
    ).toThrow(RevisionConflictError);
    const review = ledger.addHumanReview({ verificationId: 'v', currentRevision: 3, expectedRevision: 3, decision: 'CONFIRMED', note: '  ok  ' });
    expect(review).toMatchObject({ reviewType: 'HUMAN', verificationRevision: 3, note: 'ok' });
    expect(ledger.getAudit().attempts).toHaveLength(0);
  });

  it('caps history in memory and counts what was truncated; clear wipes everything', () => {
    const ledger = new RevisionLedger({ now: () => at, maxAttemptsPerVerification: 2, maxAuditRecords: 2 });
    for (let index = 0; index < 4; index++) {
      ledger.startAttempt({ verificationId: 'v', claimId: 'claim-1', inputs: INPUTS });
      ledger.invalidate({ verificationId: 'v', claimId: 'claim-1', cause: 'RETRY_REQUESTED', reason: 'r' });
    }
    const audit = ledger.getAudit();
    expect(audit.attempts).toHaveLength(2);
    expect(audit.invalidations).toHaveLength(2);
    expect(audit.truncated).toBeGreaterThanOrEqual(4);
    ledger.clear();
    expect(ledger.getAudit()).toMatchObject({ attempts: [], invalidations: [], truncated: 0 });
    expect(ledger.getLastRevision('v')).toBeUndefined();
  });
});

describe('ClaimQueue.cancel', () => {
  it('cancels a pending job and aborts an active one', async () => {
    const queue = new ClaimQueue<string>({ concurrency: 1, capacity: 5, timeoutMs: 5_000, maxRetries: 0 });
    let activeSignal: AbortSignal | undefined;
    const active = queue.enqueue({
      id: 'a',
      version: 0,
      run: (signal) => {
        activeSignal = signal;
        return new Promise<string>(() => undefined);
      },
    });
    const pending = queue.enqueue({ id: 'b', version: 0, run: () => Promise.resolve('b') });
    await new Promise((resolve) => setImmediate(resolve));

    expect(queue.cancel('b', 'inputs changed')).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(QueueCancelledError);
    expect(queue.cancel('a', 'inputs changed')).toBe(true);
    await expect(active).rejects.toBeInstanceOf(QueueCancelledError);
    expect(activeSignal?.aborted).toBe(true);
    expect(queue.cancel('missing')).toBe(false);
    expect(queue.getMetrics().active).toBe(0);
  });
});
