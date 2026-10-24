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
  LIVE_GAP_EVENT_SCHEMA,
  LIVE_METRICS_EVENT_SCHEMA,
  LIVE_SESSION_ENDED_EVENT_SCHEMA,
  LIVE_SESSION_STARTED_EVENT_SCHEMA,
  LIVE_SESSION_STATE_EVENT_SCHEMA,
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
  type SessionSnapshotData,
  type SpeakerMapping,
  type TranscriptSegment,
  type Verification,
} from '@veritas/shared';
import { extractClaims } from '#/analysis/claimExtraction.js';
import { investigateClaim } from '#/analysis/textVerificationPipeline.js';
import type { ResearchProvider } from '#/research/index.js';
import { redactSecrets } from '#/utils/security.js';
import { buildClaimKey, findDuplicate } from './claimDeduplication.js';
import {
  ClaimQueue,
  QueueCancelledError,
  QueueDeferredError,
  type ClaimQueueEvent,
} from './claimQueue.js';
import { ContextManager } from './contextManager.js';
import { LiveEventSequencer, stampEvent } from './eventEnvelope.js';
import {
  LiveSession,
  LiveSessionStateError,
  type AudioChunkAck,
  type LiveGap,
  type LiveMetric,
  type LiveSessionConfig,
  type LiveTranscriptEvent,
} from './liveSession.js';
import { sanitizeSessionSnapshot } from './sanitizeExport.js';
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
  revision: number,
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
  revision,
});

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
  /** Invalidates in-flight work without relying on providers honoring abort. */
  private readonly claimGenerations = new Map<string, number>();
  /** Revisions survive deletion so retries can never move a card backwards. */
  private readonly verificationRevisions = new Map<string, number>();
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

  start(): void {
    this.session.start();
    this.emitParsed('LIVE_SESSION_STARTED', LIVE_SESSION_STARTED_EVENT_SCHEMA, {
      sessionId: this.sessionId,
      state: this.session.getState(),
    });
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
    let revision = expectedRevision;
    const changedSpeakerIds = new Set<string>();
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
            changedSpeakerIds.add(mapping.speakerId);
          } else if (!existing.confirmed) {
            this.speakerRegistry.confirmMapping(mapping.speakerId, revision);
            changedSpeakerIds.add(mapping.speakerId);
          } else if (
            existing.participantName !== mapping.participantName.trim()
          ) {
            this.speakerRegistry.setMapping(
              mapping.speakerId,
              mapping.participantName,
              revision,
              { confirmed: true },
            );
            changedSpeakerIds.add(mapping.speakerId);
          }
        } else {
          this.speakerRegistry.setMapping(
            mapping.speakerId,
            mapping.participantName,
            revision,
            { confirmed: false },
          );
          changedSpeakerIds.add(mapping.speakerId);
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
    if (changedSpeakerIds.size > 0) {
      this.invalidateClaims(
        (record) =>
          record.claim.speakerId !== undefined &&
          changedSpeakerIds.has(record.claim.speakerId),
        'Atribuição de locutor alterada',
      );
    }
    this.emitParsed(
      'SPEAKER_MAPPING_UPDATED',
      SPEAKER_MAPPING_UPDATED_EVENT_SCHEMA,
      {
        sessionId: this.sessionId,
        mappings: current,
        revision: this.speakerRegistry.getRevision(),
      },
    );
    return current;
  }

  correctTranscript(
    segmentId: string,
    text: string,
    expectedRevision: number,
  ): TranscriptSegment {
    const corrected = this.session.correctTranscript(
      segmentId,
      text,
      expectedRevision,
    );
    this.context.addSegment(corrected);
    const affectedSegmentIds = new Set<string>([segmentId]);
    for (const record of this.claims.values()) {
      if (
        record.contextDependencies.some(
          (dependency) => dependency.id === segmentId,
        )
      ) {
        for (const dependentSegmentId of record.claim.segmentIds) {
          affectedSegmentIds.add(dependentSegmentId);
        }
      }
    }
    this.invalidateClaims(
      (record) =>
        record.claim.segmentIds.includes(segmentId) ||
        record.contextDependencies.some(
          (dependency) => dependency.id === segmentId,
        ),
      'Transcrição corrigida pelo usuário',
    );
    // Pronoun/reference extraction in later segments depended on the corrected
    // context; re-extract those segments after invalidating their old claims.
    for (const dependentId of affectedSegmentIds) {
      if (dependentId === segmentId) continue;
      const dependent = this.segmenter.getSegment(dependentId);
      if (
        dependent &&
        (dependent.status === 'FINAL' || dependent.status === 'BLOCKED')
      ) {
        this.enqueueExtraction(dependent);
      }
    }
    // Re-extract from the corrected final text (async, non-blocking).
    if (corrected.status === 'FINAL' || corrected.status === 'BLOCKED') {
      this.enqueueExtraction(corrected);
    }
    return corrected;
  }

  async retryVerification(verificationId: string): Promise<void> {
    const existing = this.verifications.get(verificationId);
    if (existing === undefined) {
      throw new LiveSessionStateError(
        `Verificação "${verificationId}" não encontrada nesta sessão`,
      );
    }
    const record = this.claims.get(existing.claimId);
    if (record === undefined) {
      throw new LiveSessionStateError(
        `Claim "${existing.claimId}" não encontrada para nova tentativa`,
      );
    }
    this.invalidateVerification(
      verificationId,
      'Nova tentativa solicitada pelo usuário',
    );
    this.claimGenerations.set(
      record.claim.id,
      (this.claimGenerations.get(record.claim.id) ?? 0) + 1,
    );
    await this.enqueueInvestigation(record.claim, record.cacheKey);
  }

  exportSnapshot(): SessionSnapshotData {
    return this.emitSnapshot();
  }

  deleteSession(reason = 'deleted'): void {
    this.cancel(reason);
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
    return this.verifications.has(verificationId);
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

  private emitSnapshot(): SessionSnapshotData {
    const media = this.session.getSnapshot(0);
    const snapshot = sanitizeSessionSnapshot({
      sessionId: this.sessionId,
      state: media.state,
      cursor: this.sequencer.getCursor(),
      segments: this.segmenter.getAllSegments(),
      claims: [...this.claims.values()].map((record) => record.claim),
      verifications: [...this.verifications.values()],
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
      this.emit[event](parsed);
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
    ) => items.map((item) => `${item.id}@${String(item.revision)}`).join('|');
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

  private async enqueueInvestigation(
    claim: Claim,
    cacheKey: string | undefined,
  ): Promise<void> {
    if (
      this.evaluationLlm === undefined ||
      this.researchProvider === undefined ||
      this.investigateClaimFn === undefined
    ) {
      const failed = bumpClaim(claim, 'FAILED', this.now().toISOString());
      this.claims.set(claim.id, {
        claim: failed,
        contextDependencies:
          this.claims.get(claim.id)?.contextDependencies ?? [],
        ...(cacheKey === undefined ? {} : { cacheKey }),
      });
      this.emitClaimStatus(failed);
      return;
    }

    const queued = bumpClaim(claim, 'QUEUED', this.now().toISOString());
    this.claims.set(claim.id, {
      claim: queued,
      contextDependencies: this.claims.get(claim.id)?.contextDependencies ?? [],
      ...(cacheKey === undefined ? {} : { cacheKey }),
    });
    this.emitClaimStatus(queued);

    const evaluationLlm = this.evaluationLlm;
    const researchProvider = this.researchProvider;
    const investigate = this.investigateClaimFn;
    const generation = this.claimGenerations.get(claim.id) ?? 0;
    const isCurrent = (): boolean =>
      !this.ended && (this.claimGenerations.get(claim.id) ?? 0) === generation;

    try {
      const verification = await this.queue.enqueue({
        id: claim.id,
        ...(cacheKey === undefined ? {} : { key: cacheKey }),
        version: generation,
        run: async (signal) => {
          if (!isCurrent()) {
            throw new QueueCancelledError('claim invalidada', claim.id);
          }
          const researching = bumpClaim(
            this.claims.get(claim.id)?.claim ?? claim,
            'RESEARCHING',
            this.now().toISOString(),
          );
          this.claims.set(claim.id, {
            claim: researching,
            contextDependencies:
              this.claims.get(claim.id)?.contextDependencies ?? [],
            ...(cacheKey === undefined ? {} : { cacheKey }),
          });
          this.emitClaimStatus(researching);

          const result = await investigate({
            claim: researching,
            evaluationLlm,
            researchProvider,
            signal,
          });
          if (!isCurrent()) {
            throw new QueueCancelledError('claim invalidada', claim.id);
          }
          const verificationId = `verification-${claim.id}-0`;
          return remapVerification(
            result,
            claim,
            (this.verificationRevisions.get(verificationId) ?? 0) + 1,
            this.now().toISOString(),
          );
        },
      });

      if (!isCurrent()) return;

      const completed = bumpClaim(
        this.claims.get(claim.id)?.claim ?? claim,
        verification.status === 'COMPLETED' ? 'COMPLETED' : verification.status,
        this.now().toISOString(),
      );
      this.claims.set(claim.id, {
        claim: completed,
        contextDependencies:
          this.claims.get(claim.id)?.contextDependencies ?? [],
        ...(cacheKey === undefined ? {} : { cacheKey }),
      });
      this.emitClaimStatus(completed);
      this.storeVerification(verification);
      this.emitParsed('VERIFICATION_RESULT', VERIFICATION_RESULT_EVENT_SCHEMA, {
        verification,
      });
    } catch (error) {
      if (error instanceof QueueDeferredError) {
        if (!isCurrent()) return;
        const deferred = bumpClaim(claim, 'DEFERRED', this.now().toISOString());
        this.claims.set(claim.id, {
          claim: deferred,
          contextDependencies:
            this.claims.get(claim.id)?.contextDependencies ?? [],
          ...(cacheKey === undefined ? {} : { cacheKey }),
        });
        this.emitClaimStatus(deferred);
        return;
      }
      if (error instanceof QueueCancelledError || this.ended) {
        if (!isCurrent()) return;
        const cancelled = bumpClaim(
          claim,
          'CANCELLED',
          this.now().toISOString(),
        );
        this.claims.set(claim.id, {
          claim: cancelled,
          contextDependencies:
            this.claims.get(claim.id)?.contextDependencies ?? [],
          ...(cacheKey === undefined ? {} : { cacheKey }),
        });
        this.emitClaimStatus(cancelled);
        return;
      }
      if (!isCurrent()) return;
      const failed = bumpClaim(claim, 'FAILED', this.now().toISOString());
      this.claims.set(claim.id, {
        claim: failed,
        contextDependencies:
          this.claims.get(claim.id)?.contextDependencies ?? [],
        ...(cacheKey === undefined ? {} : { cacheKey }),
      });
      this.emitClaimStatus(failed);
    }
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
    this.verificationRevisions.set(verification.id, verification.revision);
    this.claimToVerification.set(verification.claimId, verification.id);
  }

  private invalidateClaims(
    predicate: (record: ClaimRecord) => boolean,
    reason: string,
  ): void {
    for (const [claimId, record] of [...this.claims.entries()]) {
      if (!predicate(record)) continue;
      this.claimGenerations.set(
        claimId,
        (this.claimGenerations.get(claimId) ?? 0) + 1,
      );
      const verificationId = this.claimToVerification.get(claimId);
      if (verificationId !== undefined) {
        this.invalidateVerification(verificationId, reason);
      }
      this.claims.delete(claimId);
      this.claimToVerification.delete(claimId);
      for (const segmentId of record.claim.segmentIds) {
        this.segmentToClaims.get(segmentId)?.delete(claimId);
      }
    }
  }

  private invalidateVerification(verificationId: string, reason: string): void {
    const existing = this.verifications.get(verificationId);
    if (existing === undefined) {
      return;
    }
    const revision = existing.revision + 1;
    this.verificationRevisions.set(verificationId, revision);
    this.verifications.delete(verificationId);
    this.claimToVerification.delete(existing.claimId);
    this.emitParsed(
      'VERIFICATION_INVALIDATED',
      VERIFICATION_INVALIDATED_EVENT_SCHEMA,
      {
        verificationId,
        reason: redactSecrets(reason),
        revision,
      },
    );
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
