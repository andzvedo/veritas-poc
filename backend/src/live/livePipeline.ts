/**
 * End-to-end live capture pipeline (LIVE-006 + INIT-02 wiring).
 *
 * Owns one capture session: audio → transcription → semantic segments →
 * honest speaker ids → claim extraction/dedup → investigation queue →
 * typed server events. Transport-agnostic: callers inject `emit` and providers.
 *
 * Research never blocks transcription: claim work runs on {@link ClaimQueue}
 * while the media path keeps accepting windows.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AUDIO_CHUNK_ACK_EVENT_SCHEMA,
  CLAIM_DETECTED_EVENT_SCHEMA,
  CLAIM_STATUS_UPDATED_EVENT_SCHEMA,
  HUMAN_REVIEW_RECORDED_EVENT_SCHEMA,
  LIVE_GAP_EVENT_SCHEMA,
  LIVE_METRICS_EVENT_SCHEMA,
  LIVE_SESSION_ENDED_EVENT_SCHEMA,
  LIVE_SESSION_STARTED_EVENT_SCHEMA,
  LIVE_SESSION_STATE_EVENT_SCHEMA,
  SESSION_EXPORT_EVENT_SCHEMA,
  SESSION_SNAPSHOT_EVENT_SCHEMA,
  SPEAKER_MAPPING_UPDATED_EVENT_SCHEMA,
  TRANSCRIPT_FINAL_EVENT_SCHEMA,
  TRANSCRIPT_PARTIAL_EVENT_SCHEMA,
  TRANSCRIPT_REVISED_EVENT_SCHEMA,
  VERIFICATION_INVALIDATED_EVENT_SCHEMA,
  VERIFICATION_RESULT_EVENT_SCHEMA,
  type AudioChunkMeta,
  type Claim,
  type ClaimStatus,
  type HumanReviewDecision,
  type HumanReviewRecord,
  type InvalidationCause,
  type LiveRetentionPolicy,
  type RevisionDiff,
  type RevisionRef,
  type SessionExportData,
  type SessionExportLink,
  type SessionSnapshotData,
  type SpeakerMapping,
  type TranscriptSegment,
  type Verification,
  type VerificationInputs,
  type VerificationInvalidationRecord,
} from '@veritas/shared';
import { LlmError } from '#/llm/errors.js';
import { ResearchError } from '#/research/types.js';
import { extractClaims } from '#/analysis/claimExtraction.js';
import { investigateClaim } from '#/analysis/textVerificationPipeline.js';
import type { ResearchProvider } from '#/research/index.js';
import {
  redactSecrets,
  redactSecretText,
  safeErrorForLog,
} from '#/utils/security.js';
import { buildClaimKey, findDuplicate } from './claimDeduplication.js';
import {
  ClaimQueue,
  QueueCancelledError,
  QueueDeferredError,
  defaultIsRetryable,
  type ClaimQueueEvent,
} from './claimQueue.js';
import { ContextManager } from './contextManager.js';
import { LiveEventSequencer, stampEvent } from './eventEnvelope.js';
import {
  DEFAULT_LIVE_MAX_SESSION_MS,
  LiveSession,
  LiveSessionStateError,
  type AudioChunkAck,
  type LiveGap,
  type LiveMetric,
  type LiveSessionConfig,
  type LiveTranscriptEvent,
} from './liveSession.js';
import {
  DEFAULT_LIVE_MAX_SUPERSEDED,
  DEFAULT_LIVE_SESSION_IDLE_MS,
} from './retention.js';
import {
  classifyTextChange,
  isTypographicOnly,
  RevisionLedger,
} from './revisionLedger.js';
import {
  sanitizeSessionSnapshot,
  scrubAudit,
  scrubClaim,
  scrubInvalidation,
  scrubSegment,
  scrubVerification,
} from './sanitizeExport.js';
import {
  SpeakerMappingConflictError,
  SpeakerRegistry,
  UnknownSpeakerError,
  type DiarizationProvider,
} from './speakerIdentification.js';
import { SpeechSegmenter } from './speechSegments.js';
import type { TranscriptionProvider } from './transcription.js';

export type LivePipelineEmit = {
  LIVE_SESSION_STARTED: (event: unknown) => void;
  LIVE_SESSION_STATE: (event: unknown) => void;
  TRANSCRIPT_PARTIAL: (event: unknown) => void;
  TRANSCRIPT_FINAL: (event: unknown) => void;
  TRANSCRIPT_REVISED: (event: unknown) => void;
  SPEAKER_MAPPING_UPDATED: (event: unknown) => void;
  CLAIM_DETECTED: (event: unknown) => void;
  CLAIM_STATUS_UPDATED: (event: unknown) => void;
  VERIFICATION_RESULT: (event: unknown) => void;
  VERIFICATION_INVALIDATED: (event: unknown) => void;
  SESSION_SNAPSHOT: (event: unknown) => void;
  LIVE_METRICS: (event: unknown) => void;
  LIVE_GAP: (event: unknown) => void;
  LIVE_SESSION_ENDED: (event: unknown) => void;
  AUDIO_CHUNK_ACK: (event: unknown) => void;
  /** Optional so older transports keep compiling (LIVE-040 export). */
  SESSION_EXPORT?: (event: unknown) => void;
  HUMAN_REVIEW_RECORDED?: (event: unknown) => void;
};

export type LivePipelineApiKeys = {
  google?: string;
  tavily?: string;
};

export type LivePipelineDeps = {
  sessionId: string;
  ownerSocketId: string;
  source: 'TAB' | 'MIC';
  language: 'pt-BR';
  transcription: TranscriptionProvider;
  diarization?: DiarizationProvider;
  speakerRegistry?: SpeakerRegistry;
  emit: LivePipelineEmit;
  /** Fast model for claim extraction. */
  extractionLlm?: BaseChatModel;
  /** Advanced model for evidence evaluation / verdict. */
  evaluationLlm?: BaseChatModel;
  researchProvider?: ResearchProvider;
  apiKeys?: LivePipelineApiKeys;
  sessionConfig?: Partial<LiveSessionConfig>;
  /** Injected for tests; defaults to real extractClaims. */
  extractClaimsFn?: typeof extractClaims;
  /** Injected for tests; defaults to investigateClaim → Verification. */
  investigateClaimFn?: (args: {
    claim: Claim;
    evaluationLlm: BaseChatModel;
    researchProvider: ResearchProvider;
    signal?: AbortSignal;
  }) => Promise<Verification>;
  now?: () => Date;
  claimQueueOptions?: {
    concurrency?: number;
    capacity?: number;
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  };
  /** In-memory audit caps (LIVE-040 retention). */
  ledgerOptions?: {
    maxAttemptsPerVerification?: number;
    maxAuditRecords?: number;
  };
};

export type LivePipelineStatus = {
  sessionId: string;
  ownerSocketId: string;
  captureState: ReturnType<LiveSession['getState']>;
  claimCount: number;
  verificationCount: number;
  hasCredentials: boolean;
};

type ClaimRecord = {
  claim: Claim;
  contextDependencies: { id: string; revision: number }[];
  /** Segment revisions the claim was extracted from (LIVE-040 inputs). */
  segmentRefs?: RevisionRef[];
  /** Investigation key used for queue cache (fact-checkable only). */
  cacheKey?: string;
};

const bumpClaim = (
  claim: Claim,
  status: ClaimStatus,
  nowIso: string,
): Claim => ({
  ...claim,
  status,
  revision: claim.revision + 1,
  updatedAt: nowIso,
});

const remapVerification = (
  template: Verification,
  claim: Claim,
  nowIso: string,
): Verification => ({
  ...template,
  id: `verification-${claim.id}-0`,
  ...(claim.sessionId !== undefined ? { sessionId: claim.sessionId } : {}),
  claimId: claim.id,
  segmentIds: [...claim.segmentIds],
  ...(claim.speakerId !== undefined
    ? { speakerId: claim.speakerId }
    : { speakerId: undefined }),
  originalQuote: claim.originalQuote,
  normalizedClaim: claim.normalizedClaim,
  ...(claim.timestampMs !== undefined
    ? { timestampMs: { ...claim.timestampMs } }
    : {}),
  updatedAt: nowIso,
});

/** Stable verification id of one claim; revisions distinguish versions. */
export const verificationIdForClaim = (claimId: string): string =>
  `verification-${claimId}-0`;

/** Quota / budget exhaustion is DEFERRED, never a factual failure. */
export const isQuotaError = (error: unknown): boolean =>
  (error instanceof ResearchError || error instanceof LlmError) &&
  error.kind === 'QUOTA';

const pushCapped = <T>(list: T[], item: T, cap: number): void => {
  list.push(item);
  while (list.length > cap) {
    list.shift();
  }
};

/**
 * Builds a Verification from the shared evidence helper. Keeps live wiring off
 * the text-mode legacy projection.
 */
async function defaultInvestigate(args: {
  claim: Claim;
  evaluationLlm: BaseChatModel;
  researchProvider: ResearchProvider;
  signal?: AbortSignal;
}): Promise<Verification> {
  const data = await investigateClaim({
    claim: args.claim,
    extractionChunkIndex: 0,
    evaluationLlm: args.evaluationLlm,
    researchProvider: args.researchProvider,
    signal: args.signal,
  });
  if (data.verification !== undefined) {
    return data.verification;
  }
  // notFactCheckable path has no Verification; surface as cancelled triage.
  const now = new Date().toISOString();
  return {
    id: `verification-${args.claim.id}-0`,
    ...(args.claim.sessionId !== undefined
      ? { sessionId: args.claim.sessionId }
      : {}),
    claimId: args.claim.id,
    segmentIds: [...args.claim.segmentIds],
    ...(args.claim.speakerId !== undefined
      ? { speakerId: args.claim.speakerId }
      : {}),
    originalQuote: args.claim.originalQuote,
    normalizedClaim: args.claim.normalizedClaim,
    ...(args.claim.timestampMs !== undefined
      ? { timestampMs: { ...args.claim.timestampMs } }
      : {}),
    transcriptConfirmed: true,
    atomicClaim: {
      id: `${args.claim.id}-atomic-0`,
      proposition: args.claim.normalizedClaim,
    },
    status: 'CANCELLED',
    revision: 0,
    reviewedBy: 'AUTOMATED',
    createdAt: now,
    updatedAt: now,
    mechanisms: [],
    supportedAspects: [],
    limitations: [
      'Afirmação marcada como não verificável documentalmente; nenhuma investigação foi aberta.',
    ],
    evidence: [],
    sources: [],
  };
}

export class LivePipeline {
  readonly sessionId: string;
  /** Socket that currently controls the capture (rebound on same-instance resume). */
  ownerSocketId: string;

  private readonly session: LiveSession;
  private readonly segmenter: SpeechSegmenter;
  private readonly speakerRegistry: SpeakerRegistry;
  private readonly context: ContextManager;
  private readonly queue: ClaimQueue<Verification>;
  private readonly sequencer: LiveEventSequencer;
  private emit: LivePipelineEmit;
  private readonly extractionLlm: BaseChatModel | undefined;
  private readonly evaluationLlm: BaseChatModel | undefined;
  private readonly researchProvider: ResearchProvider | undefined;
  private readonly extractClaimsFn: typeof extractClaims;
  private readonly investigateClaimFn: LivePipelineDeps['investigateClaimFn'];
  private readonly now: () => Date;

  private apiKeys: LivePipelineApiKeys;
  private readonly claims = new Map<string, ClaimRecord>();
  private readonly verifications = new Map<string, Verification>();
  /** claimId → verificationId that depends on it. */
  private readonly claimToVerification = new Map<string, string>();
  /** segmentId → claimIds derived from it. */
  private readonly segmentToClaims = new Map<string, Set<string>>();
  /** verificationId → claimId (also for not-yet-completed attempts). */
  private readonly verificationToClaim = new Map<string, string>();
  /** claimId → queue job id of the current attempt. */
  private readonly claimJobs = new Map<string, string>();
  private readonly ledger: RevisionLedger;
  private readonly supersededClaims: Claim[] = [];
  private readonly supersededVerifications: Verification[] = [];
  private readonly maxSessionMs: number;
  private idleTtlMs = DEFAULT_LIVE_SESSION_IDLE_MS;
  private ended = false;
  private extractionChain: Promise<void> = Promise.resolve();

  constructor(deps: LivePipelineDeps) {
    this.sessionId = deps.sessionId;
    this.ownerSocketId = deps.ownerSocketId;
    this.emit = deps.emit;
    this.extractionLlm = deps.extractionLlm;
    this.evaluationLlm = deps.evaluationLlm;
    this.researchProvider = deps.researchProvider;
    this.extractClaimsFn = deps.extractClaimsFn ?? extractClaims;
    this.investigateClaimFn = deps.investigateClaimFn ?? defaultInvestigate;
    this.now = deps.now ?? (() => new Date());
    this.apiKeys = { ...(deps.apiKeys ?? {}) };
    this.sequencer = new LiveEventSequencer(this.now);
    this.ledger = new RevisionLedger({
      now: this.now,
      ...(deps.ledgerOptions ?? {}),
    });
    this.maxSessionMs =
      deps.sessionConfig?.maxSessionMs ?? DEFAULT_LIVE_MAX_SESSION_MS;
    this.speakerRegistry = deps.speakerRegistry ?? new SpeakerRegistry();
    this.segmenter = new SpeechSegmenter({
      sessionId: deps.sessionId,
      clock: this.now,
    });
    this.context = new ContextManager();
    this.queue = new ClaimQueue<Verification>({
      concurrency: deps.claimQueueOptions?.concurrency ?? 2,
      capacity: deps.claimQueueOptions?.capacity ?? 10,
      timeoutMs: deps.claimQueueOptions?.timeoutMs ?? 90_000,
      ...(deps.claimQueueOptions?.maxRetries === undefined
        ? {}
        : { maxRetries: deps.claimQueueOptions.maxRetries }),
      ...(deps.claimQueueOptions?.retryDelayMs === undefined
        ? {}
        : { retryDelayMs: deps.claimQueueOptions.retryDelayMs }),
      // Quota exhaustion is not transient: retrying would burn more budget.
      isRetryable: (error) => !isQuotaError(error) && defaultIsRetryable(error),
      onEvent: (event) => {
        this.onQueueEvent(event);
      },
    });

    this.session = new LiveSession({
      sessionId: deps.sessionId,
      transcription: deps.transcription,
      segmenter: this.segmenter,
      speakerRegistry: this.speakerRegistry,
      ...(deps.diarization === undefined
        ? {}
        : { diarization: deps.diarization }),
      ...(deps.sessionConfig === undefined
        ? {}
        : { config: deps.sessionConfig }),
      now: () => this.now().getTime(),
      onState: (event) => {
        this.emitState(event.state, event.reason);
      },
      onTranscript: (event) => {
        this.emitTranscript(event);
      },
      onGap: (gap) => {
        this.emitGap(gap);
      },
      onMetrics: (metrics) => {
        this.emitMetrics(metrics);
      },
      onAck: (ack) => {
        this.emitAck(ack);
      },
      onSegmentFinal: (segment) => {
        this.enqueueExtraction(segment);
      },
    });

    void deps.source;
    void deps.language;
  }

  /**
   * Starts capture. `resumeToken` (issued by the registry) is sent only in
   * this event to the owner socket and is never stored by the pipeline.
   */
  start(resumeToken?: string): void {
    this.session.start();
    this.emitParsed('LIVE_SESSION_STARTED', LIVE_SESSION_STARTED_EVENT_SCHEMA, {
      sessionId: this.sessionId,
      state: this.session.getState(),
      ...(resumeToken === undefined ? {} : { resumeToken }),
    });
  }

  /** Registry idle TTL, published in the export retention policy. */
  setIdleTtlMs(ms: number): void {
    this.idleTtlMs = ms;
  }

  pause(): void {
    this.session.pause();
  }

  resumeCapture(): void {
    this.session.resume();
  }

  markReconnecting(reason = 'transport_lost'): void {
    try {
      this.session.markReconnecting(reason);
    } catch (error) {
      if (!(error instanceof LiveSessionStateError)) {
        throw error;
      }
    }
  }

  handleAudioChunk(meta: AudioChunkMeta, pcm: Buffer): AudioChunkAck {
    return this.session.handleAudioChunk(meta, pcm);
  }

  async end(reason = 'requested'): Promise<void> {
    if (this.ended) {
      return;
    }
    await this.session.end(reason);
    // Final transcript callbacks may still append work to this chain. Drain it
    // before the research queue so all accepted speech reaches its terminal state.
    let extractionDrain = this.extractionChain;
    for (;;) {
      await extractionDrain;
      if (extractionDrain === this.extractionChain) break;
      extractionDrain = this.extractionChain;
    }
    // Drain investigations accepted before ENDING (bounded by queue timeouts).
    await this.queue.drain();
    this.ended = true;
    this.clearCredentials();
    this.emitParsed('LIVE_SESSION_ENDED', LIVE_SESSION_ENDED_EVENT_SCHEMA, {
      sessionId: this.sessionId,
      reason,
    });
  }

  cancel(reason = 'cancelled'): void {
    if (this.ended) {
      return;
    }
    this.queue.cancelAll(reason);
    this.session.cancel(reason);
    this.ended = true;
    this.clearCredentials();
    this.emitParsed('LIVE_SESSION_ENDED', LIVE_SESSION_ENDED_EVENT_SCHEMA, {
      sessionId: this.sessionId,
      reason,
    });
  }

  /**
   * Same-instance reconnect: emit a sanitized snapshot. Cursor is the event
   * sequencer position (frontend `eventCursor`), not the media segment cursor.
   * Restart without durable storage is rejected by the registry, not here.
   */
  resumeSession(cursor: number): SessionSnapshotData {
    // P0: full snapshot; cursor is the client eventSeq (replay not durable).
    void cursor;
    if (this.session.getState() === 'RECONNECTING') {
      // Move to PAUSED with the current media cursor; client may RESUME later.
      this.session.resumeFromCursor(this.segmenter.getCursor());
    }
    return this.emitSnapshot();
  }

  updateSpeakerMappings(
    mappings: SpeakerMapping[],
    expectedRevision: number,
  ): SpeakerMapping[] {
    const namesBefore = new Map<string, string | undefined>(
      this.speakerRegistry
        .getMappings()
        .map((mapping) => [mapping.speakerId, mapping.participantName]),
    );
    let revision = expectedRevision;
    for (const mapping of mappings) {
      try {
        if (mapping.confirmed) {
          const existing = this.speakerRegistry.getMapping(mapping.speakerId);
          if (existing === undefined) {
            this.speakerRegistry.setMapping(
              mapping.speakerId,
              mapping.participantName,
              revision,
              { confirmed: false },
            );
            revision = this.speakerRegistry.getRevision();
            this.speakerRegistry.confirmMapping(mapping.speakerId, revision);
          } else if (!existing.confirmed) {
            this.speakerRegistry.confirmMapping(mapping.speakerId, revision);
          } else if (
            existing.participantName !== mapping.participantName.trim()
          ) {
            this.speakerRegistry.setMapping(
              mapping.speakerId,
              mapping.participantName,
              revision,
              { confirmed: true },
            );
          }
        } else {
          this.speakerRegistry.setMapping(
            mapping.speakerId,
            mapping.participantName,
            revision,
            { confirmed: false },
          );
        }
      } catch (error) {
        if (
          error instanceof UnknownSpeakerError ||
          error instanceof SpeakerMappingConflictError
        ) {
          throw error;
        }
        throw error;
      }
      revision = this.speakerRegistry.getRevision();
    }

    const current = this.speakerRegistry.getMappings();
    this.emitParsed(
      'SPEAKER_MAPPING_UPDATED',
      SPEAKER_MAPPING_UPDATED_EVENT_SCHEMA,
      {
        sessionId: this.sessionId,
        mappings: current,
        revision: this.speakerRegistry.getRevision(),
      },
    );
    this.invalidateForSpeakerChanges(namesBefore, current);
    return current;
  }

  /**
   * Applies a user correction (rejects a stale `expectedRevision`).
   *
   * Decision for purely typographic corrections (case, spacing, punctuation
   * outside numbers): the segment revision still increases and the change is
   * audited, but dependent claims/verifications are kept. Any number,
   * negation or wording change supersedes the claims of the segment, cancels
   * their investigations, invalidates dependents that used the segment as
   * context and re-extracts (LIVE-040).
   */
  correctTranscript(
    segmentId: string,
    text: string,
    expectedRevision: number,
  ): TranscriptSegment {
    const before = this.segmenter.getSegment(segmentId);
    const corrected = this.session.correctTranscript(
      segmentId,
      text,
      expectedRevision,
    );
    this.context.addSegment(corrected);
    const changeKinds = classifyTextChange(before?.text ?? '', corrected.text);
    const diff: RevisionDiff = {
      field: 'TRANSCRIPT',
      before: before?.text ?? '',
      after: corrected.text,
      changeKinds,
    };

    if (isTypographicOnly(changeKinds)) {
      this.ledger.recordTypographicCorrection({
        segmentId,
        fromRevision: expectedRevision,
        toRevision: corrected.revision,
        diff,
      });
      // Rebase dependents on the new revision: their inputs did not change.
      for (const record of this.claims.values()) {
        record.segmentRefs = record.segmentRefs?.map((ref) =>
          ref.id === segmentId ? { id: ref.id, revision: corrected.revision } : ref,
        );
        record.contextDependencies = record.contextDependencies.map((ref) =>
          ref.id === segmentId ? { id: ref.id, revision: corrected.revision } : ref,
        );
      }
      this.emitStageMetric('typographic_correction_kept');
      return corrected;
    }

    // Claims extracted from other segments that used this one as context.
    const dependentSegments = new Set<string>();
    for (const [claimId, record] of this.claims) {
      const ownSegment = record.claim.segmentIds.includes(segmentId);
      if (ownSegment) {
        continue;
      }
      if (
        record.contextDependencies.some(
          (dependency) =>
            dependency.id === segmentId &&
            dependency.revision < corrected.revision,
        )
      ) {
        for (const sourceSegment of record.claim.segmentIds) {
          dependentSegments.add(sourceSegment);
        }
        void claimId;
      }
    }

    this.invalidateClaimsForSegment(
      segmentId,
      'TRANSCRIPT_CORRECTION',
      'Transcrição corrigida pelo usuário',
      diff,
    );
    for (const dependent of dependentSegments) {
      this.invalidateClaimsForSegment(
        dependent,
        'CONTEXT_CHANGED',
        'Contexto usado na extração foi corrigido',
        { ...diff, field: 'CONTEXT' },
      );
    }

    // Re-extract from the corrected final text (async, non-blocking).
    if (corrected.status === 'FINAL' || corrected.status === 'BLOCKED') {
      this.enqueueExtraction(corrected);
    }
    for (const dependent of dependentSegments) {
      const segment = this.segmenter.getSegment(dependent);
      if (
        segment !== undefined &&
        (segment.status === 'FINAL' || segment.status === 'BLOCKED')
      ) {
        this.enqueueExtraction(segment);
      }
    }
    return corrected;
  }

  async retryVerification(verificationId: string): Promise<void> {
    const claimId =
      this.verifications.get(verificationId)?.claimId ??
      this.verificationToClaim.get(verificationId);
    if (claimId === undefined) {
      throw new LiveSessionStateError(
        `Verificação "${verificationId}" não encontrada nesta sessão`,
      );
    }
    const record = this.claims.get(claimId);
    if (record === undefined) {
      throw new LiveSessionStateError(
        `Claim "${claimId}" não está mais vigente (foi substituída por uma revisão); nova tentativa recusada`,
      );
    }
    this.invalidateClaim(claimId, {
      cause: 'RETRY_REQUESTED',
      reason: 'Nova tentativa solicitada pelo usuário',
      supersede: false,
    });
    await this.enqueueInvestigation(record.claim, record.cacheKey);
  }

  /**
   * Human review of the current verification revision. Kept as a separate
   * record (`reviewType: 'HUMAN'`); the automated verdict is never altered.
   */
  submitHumanReview(args: {
    verificationId: string;
    expectedRevision: number;
    decision: HumanReviewDecision;
    note?: string;
  }): HumanReviewRecord {
    const current = this.verifications.get(args.verificationId);
    const review = this.ledger.addHumanReview({
      verificationId: args.verificationId,
      currentRevision: current?.revision,
      expectedRevision: args.expectedRevision,
      decision: args.decision,
      ...(args.note === undefined ? {} : { note: redactSecretText(args.note) }),
    });
    this.emitParsed(
      'HUMAN_REVIEW_RECORDED',
      HUMAN_REVIEW_RECORDED_EVENT_SCHEMA,
      { sessionId: this.sessionId, review },
    );
    return review;
  }

  /** @deprecated Kept for compatibility; prefer {@link exportSession}. */
  exportSnapshot(): SessionSnapshotData {
    return this.emitSnapshot();
  }

  /**
   * Structured export (LIVE-040): speech → claim → document/excerpt →
   * conclusion, with superseded versions and the audit trail. Never includes
   * audio, voice representations or credentials.
   */
  exportSession(): SessionExportData {
    const data = this.buildExport();
    this.emitParsed('SESSION_EXPORT', SESSION_EXPORT_EVENT_SCHEMA, data);
    return data;
  }

  getRetentionPolicy(): LiveRetentionPolicy {
    const limits = this.ledger.getLimits();
    return {
      storage: 'MEMORY_ONLY',
      durableAfterRestart: false,
      idleTtlMs: this.idleTtlMs,
      maxSessionMs: this.maxSessionMs,
      maxAttemptsPerVerification: limits.maxAttemptsPerVerification,
      maxAuditRecords: limits.maxAuditRecords,
      audioPersisted: false,
      voiceRepresentationsPersisted: false,
      credentialsExported: false,
    };
  }

  /** Cancels the session and wipes transcript, claims, results and audit. */
  deleteSession(reason = 'deleted'): void {
    this.cancel(reason);
    this.claims.clear();
    this.verifications.clear();
    this.claimToVerification.clear();
    this.verificationToClaim.clear();
    this.segmentToClaims.clear();
    this.claimJobs.clear();
    this.supersededClaims.length = 0;
    this.supersededVerifications.length = 0;
    this.ledger.clear();
    this.context.clear();
    this.segmenter.clear();
  }

  /** Audit trail (attempts, invalidations, human reviews), sanitized. */
  getAudit(): ReturnType<RevisionLedger['getAudit']> {
    return scrubAudit(this.ledger.getAudit());
  }

  getStatus(): LivePipelineStatus {
    return {
      sessionId: this.sessionId,
      ownerSocketId: this.ownerSocketId,
      captureState: this.session.getState(),
      claimCount: this.claims.size,
      verificationCount: this.verifications.size,
      hasCredentials:
        (this.apiKeys.google?.length ?? 0) > 0 ||
        (this.apiKeys.tavily?.length ?? 0) > 0,
    };
  }

  clearCredentials(): void {
    this.apiKeys = {};
  }

  /** Rebinds transport emission after a same-instance socket reconnect. */
  setEmit(emit: LivePipelineEmit): void {
    this.emit = emit;
  }

  hasVerification(verificationId: string): boolean {
    return (
      this.verifications.has(verificationId) ||
      this.verificationToClaim.has(verificationId)
    );
  }

  // ===== Internals =====
  private emitState(
    state: ReturnType<LiveSession['getState']>,
    reason?: string,
  ): void {
    this.emitParsed('LIVE_SESSION_STATE', LIVE_SESSION_STATE_EVENT_SCHEMA, {
      sessionId: this.sessionId,
      state,
      ...(reason === undefined ? {} : { reason: redactSecrets(reason) }),
    });
  }

  private emitTranscript(event: LiveTranscriptEvent): void {
    if (event.kind === 'final' || event.kind === 'revised') {
      this.context.addSegment(event.segment);
    }
    const payload = { segment: event.segment };
    switch (event.kind) {
      case 'provisional':
        this.emitParsed(
          'TRANSCRIPT_PARTIAL',
          TRANSCRIPT_PARTIAL_EVENT_SCHEMA,
          payload,
        );
        break;
      case 'final':
        this.emitParsed(
          'TRANSCRIPT_FINAL',
          TRANSCRIPT_FINAL_EVENT_SCHEMA,
          payload,
        );
        break;
      case 'revised':
        this.emitParsed(
          'TRANSCRIPT_REVISED',
          TRANSCRIPT_REVISED_EVENT_SCHEMA,
          payload,
        );
        break;
      default: {
        const _exhaustive: never = event.kind;
        void _exhaustive;
      }
    }
  }

  private emitGap(gap: LiveGap): void {
    this.emitParsed('LIVE_GAP', LIVE_GAP_EVENT_SCHEMA, gap);
  }

  private emitMetrics(metrics: LiveMetric): void {
    const queueMetrics = this.queue.getMetrics();
    this.emitParsed('LIVE_METRICS', LIVE_METRICS_EVENT_SCHEMA, {
      ...metrics,
      queueDepth: metrics.queueDepth + queueMetrics.queued,
      deferred: queueMetrics.deferred,
    });
  }

  private emitAck(ack: AudioChunkAck): void {
    this.emitParsed('AUDIO_CHUNK_ACK', AUDIO_CHUNK_ACK_EVENT_SCHEMA, {
      sessionId: ack.sessionId,
      chunkSeq: ack.chunkSeq,
      accepted: ack.accepted,
    });
  }

  /**
   * Invalidations that are still newer than the current verification (if
   * any). Replaying them never resurrects an old verdict.
   */
  private pendingInvalidations(): VerificationInvalidationRecord[] {
    return this.ledger.latestInvalidations().filter((record) => {
      const current = this.verifications.get(record.verificationId);
      return current === undefined || current.revision < record.revision;
    });
  }

  private emitSnapshot(): SessionSnapshotData {
    const media = this.session.getSnapshot(0);
    const snapshot = sanitizeSessionSnapshot({
      sessionId: this.sessionId,
      state: media.state,
      cursor: this.sequencer.getCursor(),
      segments: this.segmenter.getAllSegments(),
      claims: [...this.claims.values()].map((record) => record.claim),
      verifications: [...this.verifications.values()],
      invalidations: this.pendingInvalidations(),
    });
    this.emitParsed(
      'SESSION_SNAPSHOT',
      SESSION_SNAPSHOT_EVENT_SCHEMA,
      snapshot,
    );
    return snapshot;
  }

  private emitParsed(
    event: keyof LivePipelineEmit,
    schema: { parse: (value: unknown) => unknown },
    data: unknown,
  ): void {
    const stamped = stampEvent(this.sequencer, data, this.sessionId);
    const parsed = schema.parse(stamped);
    try {
      this.emit[event]?.(parsed);
    } catch {
      // Transport observers must never break the pipeline.
    }
  }

  private enqueueExtraction(segment: TranscriptSegment): void {
    this.extractionChain = this.extractionChain
      .then(() => this.extractFromSegment(segment))
      .catch((error: unknown) => {
        this.emitMetrics({
          sessionId: this.sessionId,
          stage: 'claim_extraction_error',
          latencyMs: 0,
          queueDepth: this.queue.getMetrics().queued,
          deferred: this.queue.getMetrics().deferred,
        });
        this.emitState(
          this.session.getState(),
          redactSecrets(
            error instanceof Error
              ? error.message
              : 'Falha na extração de claims',
          ),
        );
      });
  }

  private async extractFromSegment(segment: TranscriptSegment): Promise<void> {
    if (this.ended) {
      return;
    }
    // A correction may have superseded this revision while it waited.
    const latest = this.segmenter.getSegment(segment.id);
    if (latest !== undefined && latest.revision !== segment.revision) {
      return;
    }
    if (segment.status === 'BLOCKED') {
      // Authorship/overlap uncertainty: still keep the text; do not invent a speaker.
      this.emitMetrics({
        sessionId: this.sessionId,
        stage: 'segment_blocked',
        latencyMs: 0,
        queueDepth: this.queue.getMetrics().queued,
        deferred: this.queue.getMetrics().deferred,
      });
    }
    if (segment.text.trim().length === 0) {
      return;
    }
    if (this.extractionLlm === undefined) {
      this.emitMetrics({
        sessionId: this.sessionId,
        stage: 'claim_extraction_skipped',
        latencyMs: 0,
        queueDepth: this.queue.getMetrics().queued,
        deferred: this.queue.getMetrics().deferred,
      });
      return;
    }

    const window = this.context.getContext({ excludeSegmentId: segment.id });
    const started = this.now().getTime();
    const claims = await this.extractClaimsFn({
      text: segment.text,
      context: window.text,
      llm: this.extractionLlm,
      source: {
        sessionId: this.sessionId,
        segmentIds: [segment.id],
        ...(segment.speakerId === undefined
          ? {}
          : { speakerId: segment.speakerId }),
        timestampMs: { start: segment.startMs, end: segment.endMs },
      },
      fingerprint: `${this.sessionId}-${segment.id}-r${String(segment.revision)}`,
    });
    // The segment or its context may have been corrected during extraction.
    const latestSegment = this.segmenter.getSegment(segment.id);
    if (
      latestSegment === undefined ||
      latestSegment.revision !== segment.revision
    ) {
      return;
    }
    const latestWindow = this.context.getContext({
      excludeSegmentId: segment.id,
    });
    const dependencySignature = (
      items: readonly { id: string; revision: number }[],
    ): string =>
      items.map((item) => `${item.id}@${String(item.revision)}`).join('|');
    if (
      dependencySignature(latestWindow.dependencies) !==
      dependencySignature(window.dependencies)
    ) {
      this.enqueueExtraction(latestSegment);
      return;
    }
    this.emitMetrics({
      sessionId: this.sessionId,
      stage: 'claim_extraction',
      latencyMs: this.now().getTime() - started,
      queueDepth: this.queue.getMetrics().queued,
      deferred: this.queue.getMetrics().deferred,
    });

    const existing = [...this.claims.values()].map((record) => record.claim);
    for (const claim of claims) {
      const duplicate = findDuplicate(claim, existing);
      const cacheKey =
        claim.notFactCheckable || claim.atomicClaims.length !== 1
          ? undefined
          : duplicate?.claim !== undefined
            ? buildClaimKey(duplicate.claim)
            : buildClaimKey(claim);

      const record: ClaimRecord = {
        claim,
        contextDependencies: window.dependencies,
        segmentRefs: [{ id: segment.id, revision: segment.revision }],
        ...(cacheKey === undefined ? {} : { cacheKey }),
      };
      this.claims.set(claim.id, record);
      this.indexSegmentClaim(segment.id, claim.id);
      existing.push(claim);

      this.emitParsed('CLAIM_DETECTED', CLAIM_DETECTED_EVENT_SCHEMA, { claim });

      if (claim.notFactCheckable) {
        continue;
      }
      void this.enqueueInvestigation(claim, cacheKey);
    }
  }

  /** Not narrowed by TS across awaits (the flag flips during cancel/end). */
  private isEnded(): boolean {
    return this.ended;
  }

  private setClaim(claimId: string, claim: Claim): void {
    const record = this.claims.get(claimId);
    if (record === undefined) {
      return;
    }
    record.claim = claim;
  }

  private buildInputs(record: ClaimRecord): VerificationInputs {
    const speakerId = record.claim.speakerId;
    const mapping =
      speakerId === undefined
        ? undefined
        : this.speakerRegistry.getMapping(speakerId);
    return {
      claimRef: { id: record.claim.id, revision: record.claim.revision },
      segmentRefs: (
        record.segmentRefs ??
        record.claim.segmentIds.map((id) => ({
          id,
          revision: this.segmenter.getSegment(id)?.revision ?? 0,
        }))
      ).map((ref) => ({ ...ref })),
      contextRefs: record.contextDependencies.map((ref) => ({ ...ref })),
      ...(speakerId === undefined ? {} : { speakerId }),
      speakerMappingRevision: this.speakerRegistry.getRevision(),
      ...(mapping === undefined
        ? {}
        : { speakerName: mapping.participantName }),
    };
  }

  private async enqueueInvestigation(
    claim: Claim,
    cacheKey: string | undefined,
  ): Promise<void> {
    const claimId = claim.id;
    const current = (): Claim => this.claims.get(claimId)?.claim ?? claim;
    if (
      this.evaluationLlm === undefined ||
      this.researchProvider === undefined ||
      this.investigateClaimFn === undefined
    ) {
      const failed = bumpClaim(current(), 'FAILED', this.now().toISOString());
      this.setClaim(claimId, failed);
      this.emitClaimStatus(failed);
      return;
    }
    const record = this.claims.get(claimId);
    if (record === undefined || this.ended) {
      return;
    }

    const queued = bumpClaim(record.claim, 'QUEUED', this.now().toISOString());
    record.claim = queued;
    this.emitClaimStatus(queued);

    const verificationId = verificationIdForClaim(claimId);
    this.verificationToClaim.set(verificationId, claimId);
    const attempt = this.ledger.startAttempt({
      verificationId,
      claimId,
      inputs: this.buildInputs(record),
    });
    const jobId = `${claimId}#${String(attempt.attemptNumber)}`;
    this.claimJobs.set(claimId, jobId);
    const isCurrent = (): boolean =>
      this.claims.has(claimId) &&
      this.ledger.isCurrentAttempt(verificationId, attempt.id);

    const evaluationLlm = this.evaluationLlm;
    const researchProvider = this.researchProvider;
    const investigate = this.investigateClaimFn;

    try {
      const result = await this.queue.enqueue({
        id: jobId,
        ...(cacheKey === undefined ? {} : { key: cacheKey }),
        version: attempt.attemptNumber,
        run: async (signal) => {
          // Never spend research budget on inputs that already changed.
          if (!isCurrent()) {
            throw new QueueCancelledError('claim invalidada', jobId);
          }
          const researching = bumpClaim(
            current(),
            'RESEARCHING',
            this.now().toISOString(),
          );
          this.setClaim(claimId, researching);
          this.emitClaimStatus(researching);
          return investigate({
            claim: current(),
            evaluationLlm,
            researchProvider,
            signal,
          });
        },
      });

      // Late result of an attempt whose inputs changed: never publish it.
      if (!isCurrent()) {
        this.discardLateResult(attempt.id, result.verdict);
        return;
      }
      this.claimJobs.delete(claimId);

      const completed = bumpClaim(
        current(),
        result.status === 'COMPLETED' ? 'COMPLETED' : result.status,
        this.now().toISOString(),
      );
      this.setClaim(claimId, completed);
      this.emitClaimStatus(completed);
      const revision = this.ledger.nextRevision(
        verificationId,
        completed.revision,
      );
      const verification = scrubVerification({
        ...remapVerification(result, completed, this.now().toISOString()),
        id: verificationId,
        revision,
      });
      this.ledger.finishAttempt(
        attempt.id,
        result.status === 'DEFERRED'
          ? 'DEFERRED'
          : result.status === 'FAILED'
            ? 'FAILED'
            : result.status === 'CANCELLED'
              ? 'CANCELLED'
              : 'COMPLETED',
        {
          resultRevision: revision,
          ...(verification.verdict === undefined
            ? {}
            : { verdict: verification.verdict }),
        },
      );
      this.storeVerification(verification);
      this.emitParsed('VERIFICATION_RESULT', VERIFICATION_RESULT_EVENT_SCHEMA, {
        verification,
      });
    } catch (error) {
      if (!isCurrent()) {
        // Cancelled by an invalidation / superseded: already recorded.
        this.ledger.finishAttempt(attempt.id, 'CANCELLED', {
          reason: 'Tentativa cancelada: entradas mudaram',
          onlyIfRunning: true,
        });
        return;
      }
      this.claimJobs.delete(claimId);
      if (error instanceof QueueDeferredError || isQuotaError(error)) {
        const deferred = bumpClaim(
          current(),
          'DEFERRED',
          this.now().toISOString(),
        );
        this.setClaim(claimId, deferred);
        this.ledger.finishAttempt(attempt.id, 'DEFERRED', {
          reason: isQuotaError(error)
            ? 'Cota/orçamento de pesquisa ou modelo esgotado'
            : 'Fila de investigação cheia',
        });
        this.emitClaimStatus(deferred);
        return;
      }
      if (error instanceof QueueCancelledError || this.isEnded()) {
        const cancelled = bumpClaim(
          current(),
          'CANCELLED',
          this.now().toISOString(),
        );
        this.setClaim(claimId, cancelled);
        this.ledger.finishAttempt(attempt.id, 'CANCELLED', {
          reason: 'Sessão encerrada ou cancelada',
          onlyIfRunning: true,
        });
        this.emitClaimStatus(cancelled);
        return;
      }
      const failed = bumpClaim(current(), 'FAILED', this.now().toISOString());
      this.setClaim(claimId, failed);
      this.ledger.finishAttempt(attempt.id, 'FAILED', {
        reason: safeErrorForLog(error).message,
      });
      this.emitClaimStatus(failed);
    }
  }

  private discardLateResult(attemptId: string, verdict: Verification['verdict']): void {
    this.ledger.finishAttempt(attemptId, 'DISCARDED_STALE', {
      reason: 'Resultado tardio de uma versão anterior descartado',
      ...(verdict === undefined ? {} : { verdict }),
    });
    this.emitStageMetric('late_result_discarded');
  }

  private emitStageMetric(stage: string): void {
    this.emitMetrics({
      sessionId: this.sessionId,
      stage,
      latencyMs: 0,
      queueDepth: this.queue.getMetrics().queued,
      deferred: this.queue.getMetrics().deferred,
    });
  }

  private emitClaimStatus(claim: Claim): void {
    this.emitParsed('CLAIM_STATUS_UPDATED', CLAIM_STATUS_UPDATED_EVENT_SCHEMA, {
      claimId: claim.id,
      status: claim.status,
      revision: claim.revision,
    });
  }

  private storeVerification(verification: Verification): void {
    this.verifications.set(verification.id, verification);
    this.claimToVerification.set(verification.claimId, verification.id);
    this.verificationToClaim.set(verification.id, verification.claimId);
  }

  private invalidateClaimsForSegment(
    segmentId: string,
    cause: InvalidationCause,
    reason: string,
    diff?: RevisionDiff,
  ): void {
    const claimIds = this.segmentToClaims.get(segmentId);
    if (claimIds === undefined) {
      return;
    }
    for (const claimId of [...claimIds]) {
      this.invalidateClaim(claimId, {
        cause,
        reason,
        supersede: true,
        ...(diff === undefined ? {} : { diff }),
      });
    }
    claimIds.clear();
  }

  /**
   * Invalidates everything that depends on one claim: cancels the running
   * attempt (its late result will be discarded), clears the queue cache,
   * archives the current verification and publishes VERIFICATION_INVALIDATED
   * with a revision that supersedes it. With `supersede` the claim itself is
   * archived (a new revision will be extracted); otherwise it stays current
   * and the caller starts a new attempt.
   */
  private invalidateClaim(
    claimId: string,
    options: {
      cause: InvalidationCause;
      reason: string;
      supersede: boolean;
      diff?: RevisionDiff;
    },
  ): void {
    const record = this.claims.get(claimId);
    if (record === undefined) {
      return;
    }
    const verificationId = verificationIdForClaim(claimId);
    const existing = this.verifications.get(verificationId);
    const jobId = this.claimJobs.get(claimId);
    const hadAttempt = this.ledger.getLastRevision(verificationId) !== undefined ||
      this.ledger.getAttempts(verificationId).length > 0;

    if (record.cacheKey !== undefined) {
      this.queue.clearCache(record.cacheKey);
    }

    if (options.supersede) {
      const cancelled = bumpClaim(
        record.claim,
        'CANCELLED',
        this.now().toISOString(),
      );
      record.claim = cancelled;
      this.emitClaimStatus(cancelled);
      pushCapped(this.supersededClaims, cancelled, DEFAULT_LIVE_MAX_SUPERSEDED);
      this.claims.delete(claimId);
      for (const set of this.segmentToClaims.values()) {
        set.delete(claimId);
      }
    }

    if (existing !== undefined || hadAttempt) {
      const invalidation = this.ledger.invalidate({
        verificationId,
        claimId,
        cause: options.cause,
        reason: options.reason,
        floorRevision: Math.max(record.claim.revision, existing?.revision ?? 0),
        ...(existing?.verdict === undefined
          ? {}
          : { previousVerdict: existing.verdict }),
        ...(options.diff === undefined ? {} : { diff: options.diff }),
      });
      if (existing !== undefined) {
        pushCapped(
          this.supersededVerifications,
          existing,
          DEFAULT_LIVE_MAX_SUPERSEDED,
        );
        this.verifications.delete(verificationId);
        this.claimToVerification.delete(claimId);
      }
      const safe = scrubInvalidation(invalidation);
      this.emitParsed(
        'VERIFICATION_INVALIDATED',
        VERIFICATION_INVALIDATED_EVENT_SCHEMA,
        {
          verificationId: safe.verificationId,
          reason: safe.reason,
          revision: safe.revision,
          claimId: safe.claimId,
          cause: safe.cause,
          invalidatedAt: safe.invalidatedAt,
          ...(safe.attemptId === undefined ? {} : { attemptId: safe.attemptId }),
          ...(safe.previousVerdict === undefined
            ? {}
            : { previousVerdict: safe.previousVerdict }),
          ...(safe.diff === undefined ? {} : { diff: safe.diff }),
        },
      );
    }

    // Cancel after the ledger moved on so the aborted run is seen as stale.
    if (jobId !== undefined) {
      this.claimJobs.delete(claimId);
      this.queue.cancel(jobId, options.reason);
    }
  }

  /**
   * Authorship change: a speaker that already had a name now maps to another
   * participant (or is named for the first time). Dependent verifications are
   * invalidated and the same claims are re-investigated — they are not
   * dropped. Confirming the same name does not invalidate.
   */
  private invalidateForSpeakerChanges(
    namesBefore: Map<string, string | undefined>,
    current: SpeakerMapping[],
  ): void {
    for (const mapping of current) {
      const previous = namesBefore.get(mapping.speakerId);
      // First naming also changes the attributed author; confirming the same
      // name does not change any input of the verification.
      if (previous === mapping.participantName) {
        continue;
      }
      for (const record of [...this.claims.values()]) {
        if (
          record.claim.speakerId !== mapping.speakerId ||
          record.claim.notFactCheckable
        ) {
          continue;
        }
        const verificationId = verificationIdForClaim(record.claim.id);
        const hadWork =
          this.verifications.has(verificationId) ||
          this.claimJobs.has(record.claim.id);
        if (!hadWork) {
          continue;
        }
        this.invalidateClaim(record.claim.id, {
          cause: 'SPEAKER_MAPPING_CHANGED',
          reason: 'Autoria do trecho mudou (mapeamento de locutor)',
          supersede: false,
          diff: {
            field: 'SPEAKER',
            ...(previous === undefined ? {} : { before: previous }),
            after: mapping.participantName,
            changeKinds: [],
          },
        });
        void this.enqueueInvestigation(record.claim, record.cacheKey);
      }
    }
  }

  private buildExport(): SessionExportData {
    const claims = [...this.claims.values()].map((record) => record.claim);
    const verifications = [...this.verifications.values()];
    const allClaims = new Map<string, Claim>();
    for (const claim of [...this.supersededClaims, ...claims]) {
      allClaims.set(claim.id, claim);
    }
    const toLink = (
      verification: Verification,
      isCurrent: boolean,
    ): SessionExportLink => {
      const claim = allClaims.get(verification.claimId);
      const sources = new Map(
        verification.sources.map((source) => [source.id, source]),
      );
      return {
        segmentRefs: verification.segmentIds.map((id) => ({
          id,
          revision:
            this.claims.get(verification.claimId)?.segmentRefs?.find(
              (ref) => ref.id === id,
            )?.revision ??
            this.segmenter.getSegment(id)?.revision ??
            0,
        })),
        originalQuote: redactSecretText(verification.originalQuote),
        ...(verification.speakerId === undefined
          ? {}
          : { speakerId: verification.speakerId }),
        claimRef: {
          id: verification.claimId,
          revision: claim?.revision ?? 0,
        },
        normalizedClaim: redactSecretText(verification.normalizedClaim),
        verificationId: verification.id,
        verificationRevision: verification.revision,
        current: isCurrent,
        status: verification.status,
        ...(verification.verdict === undefined
          ? {}
          : { verdict: verification.verdict }),
        ...(verification.conclusion === undefined
          ? {}
          : { conclusion: redactSecretText(verification.conclusion) }),
        evidence: verification.evidence.map((item) => {
          const source = sources.get(item.sourceId);
          return {
            evidenceId: item.id,
            relation: item.relation,
            excerpt: redactSecretText(item.excerpt),
            ...(item.location === undefined ? {} : { location: item.location }),
            verifiedContent: item.verifiedContent,
            sourceId: item.sourceId,
            sourceUrl: source?.url ?? '',
            sourceTitle: redactSecretText(source?.title ?? ''),
          };
        }),
      };
    };

    const segmentHistory = this.segmenter.getAllSegments().flatMap((segment) =>
      this.segmenter.getHistory(segment.id).map((entry) => ({
        segmentId: entry.segmentId,
        revision: entry.revision,
        text: redactSecretText(entry.text),
        status: entry.status,
        ...(segment.speakerId === undefined
          ? {}
          : { speakerId: segment.speakerId }),
        recordedAt: entry.createdAt,
      })),
    );

    return {
      sessionId: this.sessionId,
      exportedAt: this.now().toISOString(),
      state: this.session.getState(),
      retention: this.getRetentionPolicy(),
      excludes: ['AUDIO', 'CREDENTIALS', 'VOICE_EMBEDDINGS'],
      segments: this.segmenter.getAllSegments().map(scrubSegment),
      segmentHistory,
      claims: claims.map(scrubClaim),
      supersededClaims: this.supersededClaims.map(scrubClaim),
      verifications: verifications.map(scrubVerification),
      supersededVerifications: this.supersededVerifications.map(
        scrubVerification,
      ),
      links: [
        ...verifications.map((verification) => toLink(verification, true)),
        ...this.supersededVerifications.map((verification) =>
          toLink(verification, false),
        ),
      ],
      audit: scrubAudit(this.ledger.getAudit()),
    };
  }

  private indexSegmentClaim(segmentId: string, claimId: string): void {
    const set = this.segmentToClaims.get(segmentId) ?? new Set<string>();
    set.add(claimId);
    this.segmentToClaims.set(segmentId, set);
  }

  private onQueueEvent(event: ClaimQueueEvent): void {
    switch (event.type) {
      case 'STARTED':
      case 'COMPLETED':
      case 'FAILED':
      case 'RETRYING':
      case 'DEFERRED':
      case 'CANCELLED':
      case 'CACHE_HIT':
        this.emitMetrics({
          sessionId: this.sessionId,
          stage: `claim_queue_${event.type.toLowerCase()}`,
          latencyMs: 0,
          queueDepth: this.queue.getMetrics().queued,
          deferred: this.queue.getMetrics().deferred,
        });
        break;
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }
}
