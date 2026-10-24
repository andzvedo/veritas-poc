/**
 * Transport-agnostic live session state machine (LIVE-006).
 *
 * It owns the audio/transcription half of a session — capture state, rolling
 * windowing, transcription, VAD skip, diarization hand-off, transcript events
 * and resource limits — and nothing about the transport (Socket.IO) or the
 * investigation queue. Callers wire callbacks.
 *
 * State machine (PRD §7):
 * `IDLE → CONNECTING → LISTENING ⇄ PAUSED → ENDING → ENDED`
 * plus `RECONNECTING` and `ERROR`.
 *
 * Guarantees:
 * - every accepted chunk is acknowledged; duplicates are rejected explicitly;
 * - lost samples always produce a `LIVE_GAP` (never a silent hole);
 * - `pause()` stops accepting/processing without compacting the media clock;
 * - `end()` drains only accepted work, bounded by `LIVE_END_DRAIN_MS`;
 * - `cancel()` aborts immediately and discards buffers;
 * - `snapshot(cursor)`/`resumeFromCursor(cursor)` replay only within this
 *   instance — there is no durable restart (P0).
 */
import type {
  AudioChunkMeta,
  AudioChunkRejectionReason as SharedAudioChunkRejectionReason,
  LiveMetricsData,
  LiveSessionErrorCode,
  LiveSessionState,
  TranscriptSegment,
} from '@veritas/shared';
import { AUDIO_CHUNK_META_SCHEMA } from '@veritas/shared';
import { redactClientMessage } from '#/utils/security.js';
import {
  isSilence,
  SpeechSegmenter,
  type SpeechWindowResult,
} from './speechSegments.js';
import type {
  DiarizationProvider,
  SpeakerRegistry,
  SpeakerObservation,
} from './speakerIdentification.js';
import { resolveSpeakerLabelForInterval } from './speakerIdentification.js';
import {
  isAbortError,
  TranscriptionUnavailableError,
  type TranscribedSegment,
  type TranscriptionProvider,
} from './transcription.js';
import {
  PCM16_BYTES_PER_SAMPLE,
  PCM16_SAMPLE_RATE,
  msToSamples,
  samplesToMs,
} from './wav.js';

export const DEFAULT_LIVE_WINDOW_MS = 8_000;
export const DEFAULT_LIVE_OVERLAP_MS = 1_000;
export const DEFAULT_LIVE_END_DRAIN_MS = 15_000;
export const DEFAULT_LIVE_MAX_PENDING_WINDOWS = 32;
export const DEFAULT_LIVE_MAX_SESSION_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_LIVE_SILENCE_THRESHOLD = 0.008;
export const DEFAULT_LIVE_GAP_TOLERANCE_SAMPLES = 0;
export const DEFAULT_LIVE_MAX_SEEN_CHUNKS = 100_000;
/** One full window plus the overlap tail, at 16 kHz mono PCM16. */
export const DEFAULT_LIVE_MAX_BUFFER_BYTES =
  msToSamples(DEFAULT_LIVE_WINDOW_MS + DEFAULT_LIVE_OVERLAP_MS) *
  PCM16_BYTES_PER_SAMPLE;

export type LiveSessionConfig = {
  windowMs: number;
  overlapMs: number;
  endDrainMs: number;
  maxBufferBytes: number;
  maxPendingWindows: number;
  maxSessionMs: number;
  silenceThreshold: number;
  gapToleranceSamples: number;
  maxSeenChunks: number;
};

export const DEFAULT_LIVE_SESSION_CONFIG: LiveSessionConfig = {
  windowMs: DEFAULT_LIVE_WINDOW_MS,
  overlapMs: DEFAULT_LIVE_OVERLAP_MS,
  endDrainMs: DEFAULT_LIVE_END_DRAIN_MS,
  maxBufferBytes: DEFAULT_LIVE_MAX_BUFFER_BYTES,
  maxPendingWindows: DEFAULT_LIVE_MAX_PENDING_WINDOWS,
  maxSessionMs: DEFAULT_LIVE_MAX_SESSION_MS,
  silenceThreshold: DEFAULT_LIVE_SILENCE_THRESHOLD,
  gapToleranceSamples: DEFAULT_LIVE_GAP_TOLERANCE_SAMPLES,
  maxSeenChunks: DEFAULT_LIVE_MAX_SEEN_CHUNKS,
};

const readPositiveNumber = (
  raw: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readNonNegativeInteger = (
  raw: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Reads the `LIVE_*` environment overrides (never throws). */
export function liveSessionConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Partial<LiveSessionConfig> {
  return {
    windowMs: readPositiveNumber(env['LIVE_WINDOW_MS'], DEFAULT_LIVE_WINDOW_MS),
    overlapMs: readNonNegativeInteger(
      env['LIVE_OVERLAP_MS'],
      DEFAULT_LIVE_OVERLAP_MS,
    ),
    endDrainMs: readPositiveNumber(
      env['LIVE_END_DRAIN_MS'],
      DEFAULT_LIVE_END_DRAIN_MS,
    ),
    maxBufferBytes: readPositiveNumber(
      env['LIVE_MAX_BUFFER_BYTES'],
      DEFAULT_LIVE_MAX_BUFFER_BYTES,
    ),
    maxPendingWindows: readPositiveNumber(
      env['LIVE_MAX_PENDING_WINDOWS'],
      DEFAULT_LIVE_MAX_PENDING_WINDOWS,
    ),
    maxSessionMs: readPositiveNumber(
      env['LIVE_MAX_SESSION_MS'],
      DEFAULT_LIVE_MAX_SESSION_MS,
    ),
    silenceThreshold: readPositiveNumber(
      env['LIVE_SILENCE_THRESHOLD'],
      DEFAULT_LIVE_SILENCE_THRESHOLD,
    ),
  };
}

// ===== Public event contracts =====
export type LiveGap = {
  sessionId: string;
  fromSample: number;
  toSample: number;
  reason: string;
};

export type LiveMetric = LiveMetricsData;

export type LiveTranscriptKind = 'provisional' | 'final' | 'revised';

export type LiveTranscriptEvent = {
  kind: LiveTranscriptKind;
  segment: TranscriptSegment;
};

export type LiveStateEvent = {
  state: LiveSessionState;
  reason?: string;
  /** Machine-readable cause when `state` is ERROR (localized by the UI). */
  code?: LiveSessionErrorCode;
};

/** Single source of truth: the wire enum in `@veritas/shared`. */
export type AudioChunkRejectionReason = SharedAudioChunkRejectionReason;

export type AudioChunkAck = {
  sessionId: string;
  chunkSeq: number;
  accepted: boolean;
  state: LiveSessionState;
  reason?: AudioChunkRejectionReason;
  gap?: LiveGap;
};

export type LiveSessionSnapshot = {
  sessionId: string;
  state: LiveSessionState;
  /** Segmenter change cursor; replay within the same instance only. */
  cursor: number;
  segments: TranscriptSegment[];
  bufferedSamples: number;
  pendingWindows: number;
};

export type LiveSessionDeps = {
  sessionId: string;
  transcription: TranscriptionProvider;
  segmenter: SpeechSegmenter;
  speakerRegistry?: SpeakerRegistry;
  diarization?: DiarizationProvider;
  config?: Partial<LiveSessionConfig>;
  env?: NodeJS.ProcessEnv;
  /** Clock used for metrics/duration limits (injectable for tests). */
  now?: () => number;
  onState?: (event: LiveStateEvent) => void;
  onTranscript?: (event: LiveTranscriptEvent) => void;
  onGap?: (gap: LiveGap) => void;
  onMetrics?: (metrics: LiveMetric) => void;
  /** Integration hook: only FINAL segments are handed to claim extraction. */
  onSegmentFinal?: (segment: TranscriptSegment) => void;
  onAck?: (ack: AudioChunkAck) => void;
};

// ===== Errors =====
export class LiveSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveSessionError';
  }
}

export class LiveSessionStateError extends LiveSessionError {
  constructor(message: string) {
    super(message);
    this.name = 'LiveSessionStateError';
  }
}

export class LiveSessionCursorError extends LiveSessionError {
  constructor(message: string) {
    super(message);
    this.name = 'LiveSessionCursorError';
  }
}

export class LiveSessionUnavailableError extends LiveSessionError {
  constructor(message: string) {
    super(message);
    this.name = 'LiveSessionUnavailableError';
  }
}

type WindowJob = {
  startSample: number;
  samples: number;
  pcm: Buffer;
  kind: 'window' | 'flush' | 'end';
};

type DrainWaiter = (drained: boolean) => void;

const clampToWindow = (value: number, max: number): number =>
  Math.min(Math.max(0, Math.round(value)), Math.max(0, max));

const normalizeTranscriptionSegments = (
  result: {
    text: string;
    confidence?: number;
    segments?: TranscribedSegment[];
  },
  windowDurationMs: number,
): TranscribedSegment[] => {
  const raw = result.segments ?? [];
  const segments: TranscribedSegment[] = [];
  for (const segment of raw) {
    const text = segment.text.trim();
    if (text.length === 0) {
      continue;
    }
    const startMs = clampToWindow(segment.startMs, windowDurationMs);
    const endMs = Math.max(
      startMs,
      clampToWindow(segment.endMs, windowDurationMs),
    );
    segments.push(
      segment.confidence === undefined
        ? { text, startMs, endMs }
        : { text, startMs, endMs, confidence: segment.confidence },
    );
  }
  if (segments.length > 0) {
    return segments;
  }
  const text = result.text.trim();
  if (text.length === 0) {
    return [];
  }
  return [
    result.confidence === undefined
      ? { text, startMs: 0, endMs: windowDurationMs }
      : {
          text,
          startMs: 0,
          endMs: windowDurationMs,
          confidence: result.confidence,
        },
  ];
};

const readChunkSeq = (meta: AudioChunkMeta): number =>
  Number.isInteger(meta.chunkSeq) && meta.chunkSeq >= 0 ? meta.chunkSeq : -1;

const isSignalAborted = (signal: AbortSignal): boolean => signal.aborted;

/**
 * Live session manager. One instance per capture; not shared between sessions
 * (the caller is responsible for authorization/isolation).
 */
export class LiveSession {
  readonly sessionId: string;

  private readonly transcription: TranscriptionProvider;
  private readonly segmenter: SpeechSegmenter;
  private readonly speakerRegistry?: SpeakerRegistry;
  private readonly diarization?: DiarizationProvider;
  private readonly config: LiveSessionConfig;
  private readonly now: () => number;
  private readonly onState?: (event: LiveStateEvent) => void;
  private readonly onTranscript?: (event: LiveTranscriptEvent) => void;
  private readonly onGap?: (gap: LiveGap) => void;
  private readonly onMetrics?: (metrics: LiveMetric) => void;
  private readonly onSegmentFinal?: (segment: TranscriptSegment) => void;
  private readonly onAck?: (ack: AudioChunkAck) => void;

  private state: LiveSessionState = 'IDLE';
  private startedAt: number | undefined;
  private cancelled: boolean = false;

  /** Rolling PCM buffer for the current window. */
  private buffer: Buffer = Buffer.alloc(0);
  private bufferStartSample = 0;
  private nextExpectedSample: number | undefined;
  private pendingGapReason: string | undefined;

  private readonly seenChunkSeqs = new Set<number>();
  private readonly pending: WindowJob[] = [];
  private activeJob: WindowJob | undefined;
  private activeAbort: AbortController | undefined;
  private diarizationAvailable: Promise<boolean> | undefined;
  private endPromise: Promise<void> | undefined;
  private readonly drainWaiters = new Set<DrainWaiter>();

  constructor(deps: LiveSessionDeps) {
    const sessionId = deps.sessionId.trim();
    if (sessionId.length === 0) {
      throw new LiveSessionError('sessionId is required');
    }
    this.sessionId = sessionId;
    this.transcription = deps.transcription;
    this.segmenter = deps.segmenter;
    this.speakerRegistry = deps.speakerRegistry;
    this.diarization = deps.diarization;
    this.now = deps.now ?? (() => Date.now());
    this.onState = deps.onState;
    this.onTranscript = deps.onTranscript;
    this.onGap = deps.onGap;
    this.onMetrics = deps.onMetrics;
    this.onSegmentFinal = deps.onSegmentFinal;
    this.onAck = deps.onAck;

    this.config = {
      ...DEFAULT_LIVE_SESSION_CONFIG,
      ...liveSessionConfigFromEnv(deps.env ?? process.env),
      ...deps.config,
    };
    this.validateConfig(this.config);
  }

  /** Sessions are memory-only in P0: a restart cannot be resumed. */
  static restoreFromPersistedState(): never {
    throw new LiveSessionUnavailableError(
      'Sessão ao vivo não pode ser restaurada: não há persistência durável (P0). Inicie uma nova sessão.',
    );
  }

  getState(): LiveSessionState {
    return this.state;
  }

  getConfig(): LiveSessionConfig {
    return { ...this.config };
  }

  /** `IDLE → CONNECTING → LISTENING`; the transport connects out of band. */
  start(): void {
    if (this.state !== 'IDLE') {
      throw new LiveSessionStateError(
        `Não é possível iniciar a sessão no estado ${this.state}`,
      );
    }
    this.setState('CONNECTING', 'start');
    this.startedAt = this.now();
    this.setState('LISTENING', 'start');
  }

  /** Stops accepting new chunks; accepted work keeps its place in the queue. */
  pause(): void {
    if (this.state !== 'LISTENING') {
      throw new LiveSessionStateError(
        `Não é possível pausar no estado ${this.state}`,
      );
    }
    this.flushBuffer('flush');
    this.pendingGapReason = 'paused';
    this.setState('PAUSED', 'user');
  }

  /** Resumes capture; queued work is processed again and gaps are explicit. */
  resume(): void {
    if (this.state !== 'PAUSED' && this.state !== 'RECONNECTING') {
      throw new LiveSessionStateError(
        `Não é possível retomar no estado ${this.state}`,
      );
    }
    if (this.state === 'RECONNECTING') {
      this.pendingGapReason = 'reconnect';
    }
    this.setState('LISTENING', 'resumed');
    this.pump();
  }

  /** Transport lost; capture is not resumed without an explicit `resume()`. */
  markReconnecting(reason = 'transport_lost'): void {
    if (this.state !== 'LISTENING' && this.state !== 'PAUSED') {
      throw new LiveSessionStateError(
        `Não é possível reconectar no estado ${this.state}`,
      );
    }
    this.pendingGapReason = 'reconnect';
    this.setState('RECONNECTING', reason);
  }

  /** Recovers from a recoverable ERROR (e.g. transcription process failure). */
  recover(): void {
    if (this.state !== 'ERROR') {
      throw new LiveSessionStateError(
        `Só é possível recuperar a partir de ERROR (estado atual ${this.state})`,
      );
    }
    this.pendingGapReason = 'recovered';
    this.setState('LISTENING', 'recovered');
    this.pump();
  }

  /**
   * Validates and accepts one audio chunk.
   *
   * The returned ACK confirms *acceptance of the chunk*, never transcription
   * completion. Duplicates, saturation and state violations are rejected with
   * an explicit reason; sample-clock holes emit a `LIVE_GAP`.
   */
  handleAudioChunk(meta: AudioChunkMeta, pcm: Buffer): AudioChunkAck {
    const chunkSeq = readChunkSeq(meta);
    const rejection = (
      reason: AudioChunkRejectionReason,
      gap?: LiveGap,
    ): AudioChunkAck => this.ack({ chunkSeq, accepted: false, reason, gap });

    const parsed = AUDIO_CHUNK_META_SCHEMA.safeParse(meta);
    if (!parsed.success) {
      return rejection('invalid');
    }
    const valid = parsed.data;
    if (
      !Buffer.isBuffer(pcm) ||
      pcm.length !== valid.samples * PCM16_BYTES_PER_SAMPLE
    ) {
      return rejection('invalid');
    }
    if (this.state === 'PAUSED') {
      return rejection('paused');
    }
    if (this.state === 'ENDING' || this.state === 'ENDED') {
      return rejection('ended');
    }
    if (this.state !== 'LISTENING') {
      return rejection('not_listening');
    }
    if (this.seenChunkSeqs.has(valid.chunkSeq)) {
      return rejection('duplicate');
    }
    if (this.pending.length >= this.config.maxPendingWindows) {
      const gap = this.emitGap(
        valid.startSample,
        valid.startSample + valid.samples,
        'pending_limit',
      );
      return rejection('pending_limit', gap);
    }
    if (
      this.startedAt !== undefined &&
      this.now() - this.startedAt > this.config.maxSessionMs
    ) {
      const gap = this.emitGap(
        valid.startSample,
        valid.startSample + valid.samples,
        'duration_limit',
      );
      this.fail('duration_limit');
      return rejection('duration_limit', gap);
    }

    const startSample = valid.startSample;
    const endSample = startSample + valid.samples;
    let appendPcm: Buffer = pcm;
    let effectiveStart = startSample;
    let gap: LiveGap | undefined;

    if (
      this.nextExpectedSample !== undefined &&
      startSample > this.nextExpectedSample + this.config.gapToleranceSamples
    ) {
      gap = this.emitGap(
        this.nextExpectedSample,
        startSample,
        this.pendingGapReason ?? 'missing_chunks',
      );
      this.pendingGapReason = undefined;
      // Do not mix discontinuous audio in the same window.
      this.flushBuffer('flush');
    } else if (
      this.nextExpectedSample !== undefined &&
      startSample < this.nextExpectedSample
    ) {
      const overlapSamples = Math.min(
        this.nextExpectedSample - startSample,
        valid.samples,
      );
      if (overlapSamples >= valid.samples) {
        this.rememberChunk(valid.chunkSeq);
        return rejection('overlap');
      }
      appendPcm = pcm.subarray(overlapSamples * PCM16_BYTES_PER_SAMPLE);
      effectiveStart = startSample + overlapSamples;
    }

    if (this.buffer.length + appendPcm.length > this.config.maxBufferBytes) {
      const overflow = this.emitGap(startSample, endSample, 'buffer_limit');
      return rejection('buffer_limit', overflow);
    }

    if (gap === undefined) {
      // The pending reason (pause/reconnect) only applies to the first hole.
      this.pendingGapReason = undefined;
    }
    if (this.buffer.length === 0) {
      this.bufferStartSample = effectiveStart;
    }
    this.buffer = Buffer.concat([this.buffer, appendPcm]);
    this.nextExpectedSample = endSample;
    this.rememberChunk(valid.chunkSeq);

    const ack = this.ack({ chunkSeq: valid.chunkSeq, accepted: true, gap });
    this.extractWindows();
    return ack;
  }

  /**
   * Ends the session: stop capture, finalize the last window, drain accepted
   * work up to `LIVE_END_DRAIN_MS`, then finalize the segmenter and emit ENDED.
   */
  end(reason = 'requested'): Promise<void> {
    this.endPromise ??= this.performEnd(reason);
    return this.endPromise;
  }

  /** Aborts immediately: in-flight work is cancelled and buffers are dropped. */
  cancel(reason = 'cancelled'): void {
    if (this.state === 'ENDED') {
      return;
    }
    this.cancelled = true;
    this.reportDiscardedWork(reason);
    this.abortActiveJob();
    this.pending.length = 0;
    this.releaseBuffers();
    this.setState('ENDED', reason);
    this.notifyDrainWaiters();
  }

  /** Applies a user correction and emits `revised` (claims invalidate elsewhere). */
  correctTranscript(
    segmentId: string,
    text: string,
    expectedRevision: number,
  ): TranscriptSegment {
    const corrected = this.segmenter.correct(segmentId, text, expectedRevision);
    this.emitTranscript({ kind: 'revised', segment: corrected });
    return corrected;
  }

  /**
   * Consistent view for reconnection. `cursor` replays only segments changed
   * after it; a new process cannot honor it (see
   * {@link LiveSession.restoreFromPersistedState}).
   */
  getSnapshot(cursor = 0): LiveSessionSnapshot {
    const segmentCursor = this.segmenter.getCursor();
    const safeCursor =
      Number.isInteger(cursor) && cursor > 0
        ? Math.min(cursor, segmentCursor)
        : 0;
    return {
      sessionId: this.sessionId,
      state: this.state,
      cursor: segmentCursor,
      segments: this.segmenter.getSegments(safeCursor),
      bufferedSamples: Math.floor(this.buffer.length / 2),
      pendingWindows: this.pending.length,
    };
  }

  /**
   * Replays changes after `cursor` for the same instance. A cursor ahead of
   * this instance is rejected instead of pretending recovery; reconnection
   * leaves the session paused until the caller explicitly resumes.
   */
  resumeFromCursor(cursor: number): LiveSessionSnapshot {
    const current = this.segmenter.getCursor();
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > current) {
      throw new LiveSessionCursorError(
        `Cursor inválido (${String(cursor)}); esta instância está em ${String(current)}. Sessões não são recuperáveis após reinício.`,
      );
    }
    if (this.state === 'ENDED') {
      throw new LiveSessionStateError(
        'Sessão encerrada não pode ser retomada; os segmentos continuam disponíveis no snapshot.',
      );
    }
    if (this.state === 'RECONNECTING') {
      this.setState('PAUSED', 'reconnected');
    }
    return this.getSnapshot(cursor);
  }

  // ===== Internals =====
  private validateConfig(config: LiveSessionConfig): void {
    if (config.windowMs <= 0) {
      throw new LiveSessionError('windowMs must be > 0');
    }
    if (config.overlapMs < 0 || config.overlapMs >= config.windowMs) {
      throw new LiveSessionError('overlapMs must be >= 0 and < windowMs');
    }
    if (config.endDrainMs <= 0) {
      throw new LiveSessionError('endDrainMs must be > 0');
    }
    if (config.maxBufferBytes < msToSamples(config.windowMs) * 2) {
      throw new LiveSessionError(
        'maxBufferBytes must hold at least one full window',
      );
    }
    if (config.maxPendingWindows < 1) {
      throw new LiveSessionError('maxPendingWindows must be >= 1');
    }
    if (config.maxSessionMs <= 0) {
      throw new LiveSessionError('maxSessionMs must be > 0');
    }
    if (config.silenceThreshold < 0) {
      throw new LiveSessionError('silenceThreshold must be >= 0');
    }
    if (config.gapToleranceSamples < 0) {
      throw new LiveSessionError('gapToleranceSamples must be >= 0');
    }
    if (config.maxSeenChunks < 1) {
      throw new LiveSessionError('maxSeenChunks must be >= 1');
    }
  }

  private setState(
    state: LiveSessionState,
    reason?: string,
    code?: LiveSessionErrorCode,
  ): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    const event: LiveStateEvent = {
      state,
      ...(reason === undefined ? {} : { reason }),
      ...(code === undefined ? {} : { code }),
    };
    this.safeNotify(this.onState, event);
  }

  private fail(reason: string, code?: LiveSessionErrorCode): void {
    if (this.state === 'ENDING' || this.state === 'ENDED') {
      return;
    }
    this.setState('ERROR', reason, code);
  }

  private rememberChunk(chunkSeq: number): void {
    this.seenChunkSeqs.add(chunkSeq);
    if (this.seenChunkSeqs.size > this.config.maxSeenChunks) {
      const oldest = this.seenChunkSeqs.values().next().value;
      if (oldest !== undefined) {
        this.seenChunkSeqs.delete(oldest);
      }
    }
  }

  private ack(input: {
    chunkSeq: number;
    accepted: boolean;
    reason?: AudioChunkRejectionReason;
    gap?: LiveGap;
  }): AudioChunkAck {
    const ack: AudioChunkAck = {
      sessionId: this.sessionId,
      chunkSeq: input.chunkSeq,
      accepted: input.accepted,
      state: this.state,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.gap === undefined ? {} : { gap: input.gap }),
    };
    this.safeNotify(this.onAck, ack);
    return ack;
  }

  private extractWindows(): void {
    const windowSamples = msToSamples(this.config.windowMs);
    const overlapSamples = msToSamples(this.config.overlapMs);
    const advanceSamples = windowSamples - overlapSamples;

    while (this.buffer.length >= windowSamples * PCM16_BYTES_PER_SAMPLE) {
      if (this.pending.length >= this.config.maxPendingWindows) {
        // Saturation: stop slicing until the queue drains. The buffer keeps the
        // audio; the next chunk is rejected with an explicit gap when it no
        // longer fits (never a silent drop).
        this.emitMetric('queue', 0);
        return;
      }
      const pcm = Buffer.from(
        this.buffer.subarray(0, windowSamples * PCM16_BYTES_PER_SAMPLE),
      );
      this.enqueue({
        startSample: this.bufferStartSample,
        samples: windowSamples,
        pcm,
        kind: 'window',
      });
      this.buffer = Buffer.from(
        this.buffer.subarray(advanceSamples * PCM16_BYTES_PER_SAMPLE),
      );
      this.bufferStartSample += advanceSamples;
    }
  }

  /**
   * Moves whatever is buffered into the queue as a (possibly short) window.
   * Used on pause, gaps and `end()` so accepted audio is never dropped.
   */
  private flushBuffer(kind: WindowJob['kind']): void {
    const samples = Math.floor(this.buffer.length / PCM16_BYTES_PER_SAMPLE);
    if (samples === 0) {
      this.buffer = Buffer.alloc(0);
      return;
    }
    const pcm = Buffer.from(
      this.buffer.subarray(0, samples * PCM16_BYTES_PER_SAMPLE),
    );
    const startSample = this.bufferStartSample;
    this.buffer = Buffer.alloc(0);
    this.bufferStartSample = startSample + samples;
    if (this.pending.length >= this.config.maxPendingWindows) {
      this.emitGap(startSample, startSample + samples, 'pending_limit');
      return;
    }
    this.enqueue({ startSample, samples, pcm, kind });
  }

  private enqueue(job: WindowJob): void {
    this.pending.push(job);
    this.emitMetric('queue', 0);
    this.pump();
  }

  private pump(): void {
    if (this.activeJob !== undefined) {
      return;
    }
    if (this.state !== 'LISTENING' && this.state !== 'ENDING') {
      return;
    }
    const job = this.pending.shift();
    if (job === undefined) {
      this.notifyDrainWaiters();
      return;
    }
    this.activeJob = job;
    void this.runJob(job);
  }

  private async runJob(job: WindowJob): Promise<void> {
    try {
      await this.processWindow(job);
    } catch (error) {
      this.handleWindowFailure(job, error);
    } finally {
      this.activeJob = undefined;
      this.activeAbort = undefined;
      this.pump();
      this.notifyDrainWaiters();
    }
  }

  private isCancelled(): boolean {
    return this.cancelled;
  }

  private async processWindow(job: WindowJob): Promise<void> {
    if (this.isCancelled()) {
      return;
    }
    const vadStarted = this.now();
    if (isSilence(job.pcm, this.config.silenceThreshold)) {
      this.emitMetric('vad', this.now() - vadStarted);
      return;
    }

    const durationMs = samplesToMs(job.samples);
    const controller = new AbortController();
    this.activeAbort = controller;
    const transcriptionStarted = this.now();
    const result = await this.transcription.transcribe(Buffer.from(job.pcm), {
      sampleRate: PCM16_SAMPLE_RATE,
      language: 'pt-BR',
      startSample: job.startSample,
      durationMs,
      signal: controller.signal,
    });
    this.emitMetric('transcription', this.now() - transcriptionStarted);
    if (this.isCancelled() || isSignalAborted(controller.signal)) {
      return;
    }

    const windowStartMs = samplesToMs(job.startSample);
    const windowEndMs = windowStartMs + durationMs;
    const speakerObservations = await this.identifySpeaker(
      job,
      windowStartMs,
      windowEndMs,
      controller.signal,
    );
    if (this.isCancelled() || isSignalAborted(controller.signal)) {
      return;
    }

    const segments = normalizeTranscriptionSegments(result, durationMs);
    if (segments.length === 0) {
      // Non-silent audio without any hypothesis: surface it on the open
      // segment as TRANSCRIPTION_ERROR instead of dropping it silently.
      this.emitMetric('empty_transcription', 0);
      this.publishSegmentation(
        this.segmenter.pushWindow(
          {
            text: '',
            startMs: windowStartMs,
            endMs: windowEndMs,
            ...(result.confidence === undefined
              ? {}
              : { confidence: result.confidence }),
          },
          {},
        ),
      );
      return;
    }

    const segmentationStarted = this.now();
    for (const segment of segments) {
      const speakerId = this.resolveSpeakerForSegment(
        speakerObservations,
        segment,
        durationMs,
      );
      const update = this.segmenter.pushWindow(
        {
          text: segment.text,
          startMs: windowStartMs + segment.startMs,
          endMs: windowStartMs + segment.endMs,
          confidence: segment.confidence ?? result.confidence,
        },
        speakerId === undefined ? {} : { speakerId },
      );
      this.publishSegmentation(update);
    }
    this.emitMetric('segmentation', this.now() - segmentationStarted);
  }

  private async identifySpeaker(
    job: WindowJob,
    startMs: number,
    endMs: number,
    signal: AbortSignal,
  ): Promise<SpeakerObservation[]> {
    const diarization = this.diarization;
    const registry = this.speakerRegistry;
    if (diarization === undefined || registry === undefined) {
      return [];
    }
    try {
      this.diarizationAvailable ??= diarization.isAvailable();
      let available: boolean;
      try {
        available = await this.diarizationAvailable;
      } catch {
        this.diarizationAvailable = undefined;
        return [];
      }
      if (!available) {
        return [];
      }
      const started = this.now();
      const observations = await diarization.identify(Buffer.from(job.pcm), {
        sessionId: this.sessionId,
        startMs,
        endMs,
        signal,
      });
      this.emitMetric('diarization', this.now() - started);
      if (observations.length === 0) {
        return [];
      }
      return observations;
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        return [];
      }
      this.emitMetric('diarization_error', 0);
      return [];
    }
  }

  private resolveSpeakerForSegment(
    observations: readonly SpeakerObservation[],
    segment: TranscribedSegment,
    windowDurationMs: number,
  ): string | undefined {
    const registry = this.speakerRegistry;
    if (registry === undefined) {
      return undefined;
    }
    const label = resolveSpeakerLabelForInterval(
      observations,
      segment.startMs,
      segment.endMs,
      windowDurationMs,
    );
    if (label === undefined) {
      if (
        new Set(observations.map((observation) => observation.speakerLabel))
          .size > 1
      ) {
        this.emitMetric('diarization_overlap', 0);
      }
      return undefined;
    }
    return registry.observe(label);
  }

  private publishSegmentation(update: SpeechWindowResult): void {
    if (update.current !== undefined) {
      this.emitTranscript({ kind: 'provisional', segment: update.current });
    }
    for (const segment of update.finalized) {
      this.emitTranscript({ kind: 'final', segment });
      if (segment.status === 'FINAL') {
        this.safeNotify(this.onSegmentFinal, segment);
      }
    }
  }

  private emitTranscript(event: LiveTranscriptEvent): void {
    this.safeNotify(this.onTranscript, event);
  }

  private emitGap(
    fromSample: number,
    toSample: number,
    reason: string,
  ): LiveGap {
    const gap: LiveGap = {
      sessionId: this.sessionId,
      fromSample: Math.max(0, Math.round(fromSample)),
      toSample: Math.max(0, Math.round(toSample)),
      reason,
    };
    this.safeNotify(this.onGap, gap);
    return gap;
  }

  private emitMetric(stage: string, latencyMs: number): void {
    const metrics: LiveMetric = {
      sessionId: this.sessionId,
      stage,
      latencyMs: Math.max(0, Math.round(latencyMs)),
      queueDepth: this.pending.length,
      deferred: 0,
    };
    try {
      this.onMetrics?.(metrics);
    } catch {
      // Metrics must never break the pipeline.
    }
  }

  private safeNotify<T>(
    callback: ((value: T) => void) | undefined,
    value: T,
  ): void {
    if (callback === undefined) {
      return;
    }
    try {
      callback(value);
    } catch {
      this.emitMetric('callback_error', 0);
    }
  }

  private handleWindowFailure(job: WindowJob, error: unknown): void {
    if (this.isCancelled() || this.state === 'ENDED' || isAbortError(error)) {
      return;
    }
    // Never lose the window silently: it becomes an explicit gap.
    this.emitGap(
      job.startSample,
      job.startSample + job.samples,
      'transcription_error',
    );
    this.emitMetric('transcription_error', 0);
    const rawMessage =
      error instanceof Error && error.message.length > 0
        ? error.message
        : 'Falha ao transcrever a janela de áudio';
    // Never echo keys/audio in the client-facing state reason.
    this.fail(
      redactClientMessage(rawMessage),
      error instanceof TranscriptionUnavailableError
        ? 'TRANSCRIPTION_UNAVAILABLE'
        : 'TRANSCRIPTION_FAILED',
    );
  }

  private async performEnd(reason: string): Promise<void> {
    if (this.state === 'ENDED') {
      return;
    }
    if (this.state === 'IDLE') {
      this.setState('ENDED', reason);
      this.notifyDrainWaiters();
      return;
    }
    this.setState('ENDING', reason);
    this.flushBuffer('end');
    // Work accepted before a pause is still queued: ENDING is allowed to drain.
    this.pump();
    const drained = await this.waitForDrain(this.config.endDrainMs);
    if (!drained) {
      this.abortActiveJob();
      this.reportDiscardedWork('end_drain_timeout');
      this.pending.length = 0;
      this.emitMetric('end_drain_timeout', this.config.endDrainMs);
    }
    const finals = this.segmenter.finalize();
    for (const segment of finals) {
      this.emitTranscript({ kind: 'final', segment });
      if (segment.status === 'FINAL') {
        this.safeNotify(this.onSegmentFinal, segment);
      }
    }
    this.emitMetric('end_drain', 0);
    this.releaseBuffers();
    this.setState('ENDED', drained ? reason : 'end_drain_timeout');
    this.notifyDrainWaiters();
  }

  private isPipelineIdle(): boolean {
    return this.activeJob === undefined && this.pending.length === 0;
  }

  private waitForDrain(timeoutMs: number): Promise<boolean> {
    if (this.isPipelineIdle()) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish: DrainWaiter = (drained) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.drainWaiters.delete(finish);
        resolve(drained);
      };
      const timer = setTimeout(
        () => {
          finish(false);
        },
        Math.max(1, timeoutMs),
      );
      this.drainWaiters.add(finish);
    });
  }

  private notifyDrainWaiters(): void {
    if (!this.isPipelineIdle()) {
      return;
    }
    for (const waiter of [...this.drainWaiters]) {
      waiter(true);
    }
  }

  private abortActiveJob(): void {
    const controller = this.activeAbort;
    if (controller !== undefined && !controller.signal.aborted) {
      controller.abort();
    }
  }

  private reportDiscardedWork(reason: string): void {
    const ranges: { from: number; to: number }[] = [];
    const active = this.activeJob;
    if (active !== undefined) {
      ranges.push({
        from: active.startSample,
        to: active.startSample + active.samples,
      });
    }
    for (const job of this.pending) {
      ranges.push({ from: job.startSample, to: job.startSample + job.samples });
    }
    const bufferedSamples = Math.floor(
      this.buffer.length / PCM16_BYTES_PER_SAMPLE,
    );
    if (bufferedSamples > 0) {
      ranges.push({
        from: this.bufferStartSample,
        to: this.bufferStartSample + bufferedSamples,
      });
    }
    ranges
      .sort((left, right) => left.from - right.from)
      .forEach((range) => {
        this.emitGap(range.from, range.to, reason);
      });
  }

  private releaseBuffers(): void {
    this.buffer = Buffer.alloc(0);
    this.seenChunkSeqs.clear();
    this.pending.length = 0;
    this.activeJob = undefined;
    this.activeAbort = undefined;
  }
}
