/**
 * LIVE-040 — revisions, invalidation, late results, audit and export.
 * Drives LivePipeline directly with scripted transcription/diarization.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Claim, TranscriptSegment, Verification } from '@veritas/shared';
import { SESSION_EXPORT_DATA_SCHEMA } from '@veritas/shared';
import { LlmError } from '#/llm/errors.js';
import { RevisionConflictError } from '#/live/revisionLedger.js';
import { SegmentRevisionConflictError } from '#/live/speechSegments.js';
import {
  claimPerSegment,
  createHarness,
  deferred,
  flush,
  makeVerification,
  type Deferred,
  type Harness,
} from '../helpers/livePipelineHarness.js';

const LINES = [
  'O Pix foi criado em 2020 pelo Banco Central do Brasil.',
  'Ele já movimentou mais de 17 trilhões de reais desde então.',
  'Essa terceira fala ainda está aberta no fim da sessão.',
];

type Data = Record<string, unknown>;
const data = (payload: Record<string, unknown>): Data => payload['data'] as Data;

const finals = (h: Harness): TranscriptSegment[] =>
  h.of('TRANSCRIPT_FINAL').map((p) => data(p)['segment'] as TranscriptSegment);

const segment = (h: Harness, index: number): TranscriptSegment => {
  const found = finals(h).at(index);
  if (found === undefined) {
    throw new Error(`segment ${String(index)} not final`);
  }
  return found;
};

const results = (h: Harness): Verification[] =>
  h.of('VERIFICATION_RESULT').map((p) => data(p)['verification'] as Verification);

const invalidations = (h: Harness): Data[] =>
  h.of('VERIFICATION_INVALIDATED').map(data);

/** Investigation mock: every call gets its own deferred unless `auto`. */
const controlledInvestigation = (auto = false) => {
  const calls: { claim: Claim; done: Deferred<Verification>; signal?: AbortSignal }[] = [];
  const fn = vi.fn(
    (args: { claim: Claim; signal?: AbortSignal }): Promise<Verification> => {
      if (auto) {
        return Promise.resolve(
          makeVerification(args.claim, {
            conclusion: `Conclusão: ${args.claim.normalizedClaim}`,
          }),
        );
      }
      const done = deferred<Verification>();
      calls.push({
        claim: args.claim,
        done,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      });
      return done.promise;
    },
  );
  return { fn, calls };
};

describe('LIVE-040 transcript corrections', () => {
  it('rejects a correction based on a stale revision without invalidating anything', async () => {
    const research = controlledInvestigation(true);
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
    });
    h.pipeline.start();
    await h.sendWindows(2);
    const seg = segment(h, 0);

    expect(() =>
      h.pipeline.correctTranscript(seg.id, 'O Pix foi criado em 2021.', seg.revision + 5),
    ).toThrow(SegmentRevisionConflictError);
    expect(invalidations(h)).toHaveLength(0);
    expect(results(h)).toHaveLength(1);
  });

  it('cancels research when a number is corrected and never publishes the old result', async () => {
    const research = controlledInvestigation();
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
    });
    h.pipeline.start();
    await h.sendWindows(2);
    const seg = segment(h, 0);
    expect(research.calls).toHaveLength(1);
    const first = research.calls[0];

    h.pipeline.correctTranscript(
      seg.id,
      'O Pix foi criado em 2021 pelo Banco Central do Brasil.',
      seg.revision,
    );
    await flush();

    const [invalidation] = invalidations(h);
    expect(invalidation).toMatchObject({
      cause: 'TRANSCRIPT_CORRECTION',
      claimId: first.claim.id,
    });
    expect((invalidation['diff'] as Data)['changeKinds']).toContain('NUMBER');
    expect(first.signal?.aborted).toBe(true);

    // The old provider resolves late: it must be ignored.
    first.done.resolve(makeVerification(first.claim, { conclusion: 'RESULTADO ANTIGO' }));
    await flush();
    expect(results(h).some((v) => v.conclusion === 'RESULTADO ANTIGO')).toBe(false);

    // Re-extraction produced a new attempt for the corrected text.
    expect(research.calls).toHaveLength(2);
    const second = research.calls[1];
    expect(second.claim.normalizedClaim).toContain('2021');
    second.done.resolve(makeVerification(second.claim, { conclusion: 'Nova conclusão' }));
    await flush();

    const published = results(h);
    expect(published).toHaveLength(1);
    expect(published[0].conclusion).toBe('Nova conclusão');
    expect(published[0].revision).toBeGreaterThan(invalidation['revision'] as number);

    const audit = h.pipeline.getAudit();
    expect(audit.attempts.map((a) => a.status)).toEqual(['CANCELLED', 'COMPLETED']);
    expect(new Set(audit.attempts.map((a) => a.reviewType))).toEqual(new Set(['AUTOMATED']));
    expect(audit.invalidations).toHaveLength(1);
  });

  it('keeps results for a purely typographic correction and audits the decision', async () => {
    const research = controlledInvestigation(true);
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
    });
    h.pipeline.start();
    await h.sendWindows(2);
    const seg = segment(h, 0);
    const before = results(h)[0];

    const corrected = h.pipeline.correctTranscript(
      seg.id,
      'o pix foi criado em 2020, pelo banco central do brasil',
      seg.revision,
    );
    await flush();

    expect(corrected.revision).toBeGreaterThan(seg.revision);
    expect(invalidations(h)).toHaveLength(0);
    expect(research.fn).toHaveBeenCalledTimes(1);
    const snapshot = h.pipeline.resumeSession(0);
    expect(snapshot.verifications.map((v) => v.id)).toEqual([before.id]);
    const audit = h.pipeline.getAudit();
    expect(audit.typographicCorrections).toHaveLength(1);
    expect(audit.typographicCorrections[0]).toMatchObject({
      segmentId: seg.id,
      decision: 'KEEP_RESULTS',
    });
    expect(
      h.of('LIVE_METRICS').some((p) => data(p)['stage'] === 'typographic_correction_kept'),
    ).toBe(true);
  });

  it('invalidates and re-extracts claims whose context used the corrected segment', async () => {
    const research = controlledInvestigation(true);
    const extract = vi.fn(claimPerSegment());
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: extract,
      investigateClaimFn: research.fn,
    });
    h.pipeline.start();
    await h.sendWindows(3);
    const seg1 = segment(h, 0);
    const seg2 = segment(h, 1);
    expect(results(h)).toHaveLength(2);
    const extractionsBefore = extract.mock.calls.length;

    h.pipeline.correctTranscript(
      seg1.id,
      'O Pix não foi criado em 2020 pelo Banco Central do Brasil.',
      seg1.revision,
    );
    await flush();

    const causes = invalidations(h).map((i) => [i['claimId'], i['cause']]);
    expect(causes).toContainEqual([`claim-${seg1.id}`, 'TRANSCRIPT_CORRECTION']);
    expect(causes).toContainEqual([`claim-${seg2.id}`, 'CONTEXT_CHANGED']);
    const reExtracted = extract.mock.calls
      .slice(extractionsBefore)
      .map((call) => (call[0] as { source: { segmentIds: string[] } }).source.segmentIds[0]);
    expect(reExtracted).toEqual(expect.arrayContaining([seg1.id, seg2.id]));
    const ownInvalidation = invalidations(h).find(
      (i) => i['claimId'] === `claim-${seg1.id}`,
    );
    expect((ownInvalidation?.['diff'] as Data)['changeKinds']).toContain('NEGATION');
  });
});

describe('LIVE-040 snapshot and speaker changes', () => {
  it('replays pending invalidations in the snapshot without resurrecting the old verdict', async () => {
    let round = 0;
    let lastClaim: Claim | undefined;
    const pending = deferred<Verification>();
    const investigate = vi.fn((args: { claim: Claim }): Promise<Verification> => {
      round += 1;
      lastClaim = args.claim;
      return round === 1
        ? Promise.resolve(makeVerification(args.claim, { conclusion: 'Antiga' }))
        : pending.promise;
    });
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: investigate,
    });
    h.pipeline.start();
    await h.sendWindows(2);
    const old = results(h)[0];

    void h.pipeline.retryVerification(old.id);
    await flush();

    const during = h.pipeline.resumeSession(0);
    expect(during.verifications.find((v) => v.id === old.id)).toBeUndefined();
    const replay = during.invalidations?.find((i) => i.verificationId === old.id);
    expect(replay?.cause).toBe('RETRY_REQUESTED');
    expect(replay?.revision).toBeGreaterThan(old.revision);

    if (lastClaim === undefined) throw new Error('no investigation');
    pending.resolve(makeVerification(lastClaim, { conclusion: 'Nova' }));
    await flush();
    const after = h.pipeline.resumeSession(0);
    const current = after.verifications.find((v) => v.id === old.id);
    expect(current?.conclusion).toBe('Nova');
    expect(after.invalidations?.some((i) => i.verificationId === old.id)).toBe(false);
  });

  it('re-investigates (and keeps) claims when the speaker name changes, not on confirmation', async () => {
    const research = controlledInvestigation(true);
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
    });
    h.pipeline.start();
    await h.sendWindows(2);
    const seg = segment(h, 0);
    expect(seg.speakerId).toBeDefined();
    const speakerId = seg.speakerId ?? '';
    expect(research.fn).toHaveBeenCalledTimes(1);

    h.pipeline.updateSpeakerMappings(
      [{ speakerId, participantName: 'Ana', confirmed: false, revision: 0 }],
      0,
    );
    await flush();
    expect(invalidations(h)).toHaveLength(1);
    expect(invalidations(h)[0]).toMatchObject({ cause: 'SPEAKER_MAPPING_CHANGED' });
    expect(research.fn).toHaveBeenCalledTimes(2);

    // Confirming the same name changes no verification input.
    const revision = h.pipeline.getStatus().claimCount > 0
      ? (data(h.of('SPEAKER_MAPPING_UPDATED').at(-1) ?? {})['revision'] as number)
      : 0;
    h.pipeline.updateSpeakerMappings(
      [{ speakerId, participantName: 'Ana', confirmed: true, revision }],
      revision,
    );
    await flush();
    expect(invalidations(h)).toHaveLength(1);

    const latestRevision = data(h.of('SPEAKER_MAPPING_UPDATED').at(-1) ?? {})['revision'] as number;
    h.pipeline.updateSpeakerMappings(
      [{ speakerId, participantName: 'Bia', confirmed: true, revision: latestRevision }],
      latestRevision,
    );
    await flush();
    const last = invalidations(h).at(-1);
    expect(last).toMatchObject({ cause: 'SPEAKER_MAPPING_CHANGED' });
    expect(last?.['diff']).toMatchObject({ field: 'SPEAKER', before: 'Ana', after: 'Bia' });
    expect(research.fn).toHaveBeenCalledTimes(3);
    // The claim is kept and has a fresh result newer than the invalidation.
    expect(h.pipeline.getStatus().claimCount).toBe(1);
    const latest = results(h).at(-1);
    expect(latest?.revision).toBeGreaterThan(last?.['revision'] as number);
  });
});

describe('LIVE-040 human review and export', () => {
  it('records human review separately and rejects a stale revision', async () => {
    const research = controlledInvestigation(true);
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
    });
    h.pipeline.start();
    await h.sendWindows(2);
    const verification = results(h)[0];

    expect(() =>
      h.pipeline.submitHumanReview({
        verificationId: verification.id,
        expectedRevision: verification.revision - 1,
        decision: 'DISPUTED',
      }),
    ).toThrow(RevisionConflictError);

    const review = h.pipeline.submitHumanReview({
      verificationId: verification.id,
      expectedRevision: verification.revision,
      decision: 'DISPUTED',
      note: 'Fonte primária diz outra coisa. chave AIzaSyA1234567890abcdefghijklmnopqrstuv',
    });
    expect(review.reviewType).toBe('HUMAN');
    expect(review.note).not.toContain('AIzaSyA1234567890');
    expect(h.of('HUMAN_REVIEW_RECORDED')).toHaveLength(1);
    // The automated verdict is untouched.
    const snapshot = h.pipeline.resumeSession(0);
    expect(snapshot.verifications[0].verdict).toBe(verification.verdict);
    const audit = h.pipeline.getAudit();
    expect(audit.humanReviews).toHaveLength(1);
    expect(new Set(audit.attempts.map((a) => a.reviewType))).toEqual(new Set(['AUTOMATED']));
  });

  it('exports speech → claim → evidence → conclusion with history, without audio or keys', async () => {
    const research = controlledInvestigation(true);
    const googleKey = 'AIzaSyB0000000000000000000000000000000';
    const tavilyKey = 'tvly-secret-0000000000000000000000';
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
      apiKeys: { google: googleKey, tavily: tavilyKey },
    });
    h.pipeline.start();
    await h.sendWindows(2);
    const seg = segment(h, 0);
    h.pipeline.correctTranscript(
      seg.id,
      'O Pix foi criado em 2021 pelo Banco Central do Brasil.',
      seg.revision,
    );
    await flush();

    const exported = h.pipeline.exportSession();
    expect(() => SESSION_EXPORT_DATA_SCHEMA.parse(exported)).not.toThrow();
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(googleKey);
    expect(serialized).not.toContain(tavilyKey);
    expect(serialized).not.toMatch(/"pcm"|"audio"\s*:/u);
    expect(exported.excludes).toEqual(
      expect.arrayContaining(['AUDIO', 'CREDENTIALS', 'VOICE_EMBEDDINGS']),
    );
    expect(exported.retention).toMatchObject({
      storage: 'MEMORY_ONLY',
      durableAfterRestart: false,
      audioPersisted: false,
      credentialsExported: false,
    });
    const current = exported.links.find((link) => link.current);
    expect(current).toBeDefined();
    expect(current?.segmentRefs[0]?.id).toBe(seg.id);
    expect(current?.normalizedClaim).toContain('2021');
    expect(current?.evidence[0]).toMatchObject({
      relation: 'SUPPORTS',
      sourceUrl: 'https://www.bcb.gov.br/estabilidadefinanceira/pix',
    });
    expect(current?.conclusion).toContain('2021');
    // The superseded version stays in the export, marked as not current.
    expect(exported.links.some((link) => !link.current)).toBe(true);
    expect(exported.supersededVerifications.length).toBeGreaterThan(0);
    expect(exported.audit.invalidations.length).toBeGreaterThan(0);
    expect(exported.segmentHistory.length).toBeGreaterThan(0);
    expect(h.of('SESSION_EXPORT')).toHaveLength(1);
  });
});

describe('LIVE-040/038 failures, cancellation and deletion', () => {
  it('marks quota exhaustion as DEFERRED without retrying', async () => {
    const investigate = vi.fn((): Promise<Verification> =>
      Promise.reject(new LlmError('QUOTA', 'quota exceeded')),
    );
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: investigate,
      claimQueueOptions: { maxRetries: 3, retryDelayMs: 0 },
    });
    h.pipeline.start();
    await h.sendWindows(2);
    await flush();

    expect(investigate).toHaveBeenCalledTimes(1);
    const statuses = h.of('CLAIM_STATUS_UPDATED').map((p) => data(p)['status']);
    expect(statuses.at(-1)).toBe('DEFERRED');
    expect(h.pipeline.getAudit().attempts[0]?.status).toBe('DEFERRED');
  });

  it('does not let one claim failure block another', async () => {
    const investigate = vi.fn((args: { claim: Claim }): Promise<Verification> =>
      args.claim.normalizedClaim.includes('Pix foi criado')
        ? Promise.reject(new Error('provider exploded with key tvly-abc'))
        : Promise.resolve(makeVerification(args.claim)),
    );
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: investigate,
    });
    h.pipeline.start();
    await h.sendWindows(3);

    const statusByClaim = new Map<string, unknown>();
    for (const payload of h.of('CLAIM_STATUS_UPDATED')) {
      statusByClaim.set(data(payload)['claimId'] as string, data(payload)['status']);
    }
    expect([...statusByClaim.values()]).toEqual(['FAILED', 'COMPLETED']);
    expect(results(h)).toHaveLength(1);
  });

  it('cancel stops research immediately and clears credentials', async () => {
    const research = controlledInvestigation();
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
      apiKeys: { google: 'AIzaSyC0000000000000000000000000000000' },
    });
    h.pipeline.start();
    await h.sendWindows(3);
    expect(h.pipeline.getStatus().hasCredentials).toBe(true);
    expect(research.calls.length).toBeGreaterThan(0);

    h.pipeline.cancel('user');
    await flush();
    expect(research.calls.every((call) => call.signal?.aborted === true)).toBe(true);
    expect(h.pipeline.getStatus().hasCredentials).toBe(false);
    research.calls.forEach((call) => {
      call.done.resolve(makeVerification(call.claim));
    });
    await flush();
    expect(results(h)).toHaveLength(0);
    expect(h.of('LIVE_SESSION_ENDED')).toHaveLength(1);
  });

  it('end drains research and finalizes the last open phrase', async () => {
    // Slow provider: results arrive only after END was requested.
    const investigate = vi.fn(
      (args: { claim: Claim }): Promise<Verification> =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(makeVerification(args.claim));
          }, 30);
        }),
    );
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: investigate,
    });
    h.pipeline.start();
    await h.sendWindows(3);
    expect(results(h)).toHaveLength(0);
    await h.pipeline.end('requested');

    // The open third phrase became final on END and was also verified.
    expect(finals(h)).toHaveLength(3);
    expect(results(h)).toHaveLength(3);
    const order = h.events.map((e) => e.event);
    expect(order.lastIndexOf('VERIFICATION_RESULT')).toBeLessThan(
      order.indexOf('LIVE_SESSION_ENDED'),
    );
    expect(h.pipeline.getStatus().hasCredentials).toBe(false);
  });

  it('acknowledges a duplicated chunk without duplicating transcript', async () => {
    const research = controlledInvestigation(true);
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
    });
    h.pipeline.start();
    await h.sendWindows(1);
    await h.sendWindows(1, 0);
    await h.sendWindows(1, 1);
    const acks = h.of('AUDIO_CHUNK_ACK').map(data);
    expect(acks.filter((ack) => ack['chunkSeq'] === 0)).toHaveLength(2);
    expect(finals(h)).toHaveLength(1);
    expect(finals(h)[0].text).toBe(LINES[0]);
  });

  it('deleteSession wipes transcript, claims, results and audit', async () => {
    const research = controlledInvestigation(true);
    const h = createHarness({
      lines: LINES,
      extractClaimsFn: claimPerSegment(),
      investigateClaimFn: research.fn,
      apiKeys: { tavily: 'tvly-secret-1111111111111111111' },
    });
    h.pipeline.start();
    await h.sendWindows(2);
    h.pipeline.deleteSession();

    const exported = h.pipeline.exportSession();
    expect(exported.segments).toHaveLength(0);
    expect(exported.claims).toHaveLength(0);
    expect(exported.verifications).toHaveLength(0);
    expect(exported.audit.attempts).toHaveLength(0);
    expect(h.pipeline.getStatus().hasCredentials).toBe(false);
  });
});
