/* global AudioContext, AudioContextOptions, AudioContextState, AudioWorkletNode, GainNode, MediaStream, MediaStreamAudioSourceNode, MessageEvent */
/**
 * Audio chunking and streaming for Veritas Live (LIVE-003).
 *
 * Responsibilities:
 * - capture the microphone audio through an `AudioWorklet` without routing it to the
 *   speakers (no echo: the processor never writes to its output);
 * - convert it to mono 16 kHz `pcm16le` chunks of ~100 ms with an explicit
 *   sample clock (`startSample`, `samples`);
 * - assign `chunkSeq` and hand the chunk to the transport;
 * - apply bounded flow control (`ChunkFlowController`): at most `maxInFlight`
 *   chunks unacknowledged, retries reuse the same `chunkSeq`, and every lost
 *   sample is surfaced as an explicit gap.
 *
 * Deliberate limitations:
 * - No `ScriptProcessorNode` fallback: if `AudioWorklet` is unavailable the
 *   caller gets a typed error and a clear UI message.
 * - The `MediaStream` tracks are **not** stopped here; `AudioCapture` (micCapture) owns
 *   them (LIVE-002).
 * - Browser APIs are only touched when a method is called, so importing this
 *   module outside a browser is safe.
 */

import type { AudioChunkMeta } from '@veritas/shared';

import {
  ChunkFlowController,
  type ChunkDescriptor,
  type ChunkFailureResult,
  type GapRange,
  type GapReport,
} from './flowControl';

/** Sample rate required by the transcription contract. */
export const AUDIO_TARGET_SAMPLE_RATE = 16000;
/** Default chunk duration. 100 ms == 1600 samples at 16 kHz. */
export const AUDIO_CHUNK_MS = 100;
/** Default worklet URL (served from `frontend/public`). */
export const AUDIO_WORKLET_URL = '/audio-worklet/pcm-worklet.js';
/** Name registered by `pcm-worklet.js`. */
export const PCM_WORKLET_PROCESSOR_NAME = 'pcm-worklet';

/** Chunk metadata handed to the transport: `capturedAt` is stamped by the sender. */
export type AudioChunkMetaPayload = Omit<AudioChunkMeta, 'capturedAt'>;

export type AudioChunkerErrorCode =
  | 'ALREADY_RUNNING'
  | 'NOT_RUNNING'
  | 'MISSING_HANDLER'
  | 'INVALID_STREAM'
  | 'UNSUPPORTED_AUDIO_CONTEXT'
  | 'UNSUPPORTED_AUDIO_WORKLET'
  | 'WORKLET_LOAD_FAILED'
  | 'WORKLET_RUNTIME_ERROR'
  | 'CONTEXT_RESUME_FAILED'
  | 'CONTEXT_CLOSED'
  | 'CHUNK_HANDLER_FAILED'
  | 'CHUNK_BUFFER_LOST';

/** Typed pipeline error: `code` is stable, `message` is user-facing (pt-BR). */
export class AudioChunkerError extends Error {
  readonly code: AudioChunkerErrorCode;

  constructor(
    code: AudioChunkerErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AudioChunkerError';
    this.code = code;
  }
}

export interface AudioChunkHandlers {
  /**
   * Receives every accepted chunk. The `ArrayBuffer` is a fresh
   * `pcm16le` payload; `capturedAt` is intentionally not included here
   * (the sender stamps it when building the `AUDIO_CHUNK` event).
   */
  onChunk: (meta: AudioChunkMetaPayload, buffer: ArrayBuffer) => void;
  /** Asynchronous pipeline failures (worklet crash, context closed, ...). */
  onError?: (error: AudioChunkerError) => void;
  /** A range of audio that will never be delivered. Must reach `LIVE_GAP`. */
  onGap?: (gap: GapRange) => void;
}

export interface AudioChunkerOptions extends Partial<AudioChunkHandlers> {
  /** Maximum chunks awaiting ACK. Default: 8. */
  maxInFlight?: number;
  /** Retries per chunk before it is dropped and reported as a gap. Default: 3. */
  maxRetries?: number;
  /** Chunk duration in ms. Default: 100. */
  chunkMs?: number;
  /** Worklet module URL. Default: `/audio-worklet/pcm-worklet.js`. */
  workletUrl?: string;
  /** How long `stop({flush:true})` waits for the final worklet chunk. Default: 1000 ms. */
  flushTimeoutMs?: number;
}

export interface AudioChunkerMetrics {
  running: boolean;
  paused: boolean;
  contextState: AudioContextState | null;
  /** Sample rate actually used by the AudioContext (may be != 16000). */
  contextSampleRate: number | null;
  targetSampleRate: number;
  chunkMs: number;
  chunksEmitted: number;
  chunksAcked: number;
  chunksRetried: number;
  chunksDropped: number;
  samplesEmitted: number;
  nextChunkSeq: number;
  nextSample: number;
  inFlight: number;
  maxInFlight: number;
  gaps: GapReport;
  /** Media clock jumps treated as gaps (pause/resume). */
  clockSkips: number;
  /** Chunks whose worklet clock disagreed with the controller clock. */
  clockOverlaps: number;
  workletErrors: number;
  invalidMessages: number;
  /** Chunks re-delivered by `stop({flush:true})`. */
  finalFlushChunks: number;
  startedAt: string | null;
  lastChunkAt: string | null;
}

const DEFAULT_MAX_IN_FLIGHT = 8;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CHUNK_MS = AUDIO_CHUNK_MS;
const DEFAULT_FLUSH_TIMEOUT_MS = 1000;

interface WorkletChunkMessage {
  type: 'chunk';
  buffer: ArrayBuffer;
  samples: number;
  startSample: number;
}

type AudioContextConstructor = new (
  options?: AudioContextOptions,
) => AudioContext;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    typeof ArrayBuffer !== 'undefined' &&
    (value instanceof ArrayBuffer ||
      (isRecord(value) &&
        Object.prototype.toString.call(value) === '[object ArrayBuffer]'))
  );
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  const scope = globalThis as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  const candidate = scope.AudioContext ?? scope.webkitAudioContext;

  return typeof candidate === 'function' ? candidate : null;
}

async function closeContextQuietly(context: AudioContext): Promise<void> {
  try {
    if (context.state !== 'closed') {
      await context.close();
    }
  } catch {
    // Closing an already closed/unavailable context is not actionable.
  }
}

/**
 * Captures a microphone stream and emits 16 kHz PCM chunks with flow control.
 *
 * One instance == one capture session. Call `start(stream)` from a user gesture
 * handler (the AudioContext needs it), and `stop()` before dropping the
 * reference so the context, worklet and buffers are released.
 */
export class AudioChunker {
  private readonly options: Required<
    Omit<AudioChunkerOptions, keyof AudioChunkHandlers>
  >;
  private readonly flow: ChunkFlowController;
  private handlers: Partial<AudioChunkHandlers>;

  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private silentSink: GainNode | null = null;

  private running = false;
  private paused = false;
  /** Set on pause() and cleared only when the paused span is reported as a gap. */
  private pauseGapPending = false;
  private flushing = false;
  private flushWaiter: (() => void) | null = null;

  /**
   * Latest payload per in-flight chunk, kept so a retry/forced final delivery
   * re-sends the exact same bytes without another copy from the worklet.
   * Bounded by `maxInFlight` (~26 KB at 100 ms chunks).
   */
  private readonly pendingBuffers = new Map<number, ArrayBuffer>();

  private contextSampleRate: number | null = null;
  private contextState: AudioContextState | null = null;
  private startedAt: string | null = null;
  private lastChunkAt: string | null = null;

  private readonly counters = {
    chunksEmitted: 0,
    chunksAcked: 0,
    chunksRetried: 0,
    chunksDropped: 0,
    samplesEmitted: 0,
    clockSkips: 0,
    clockOverlaps: 0,
    workletErrors: 0,
    invalidMessages: 0,
    finalFlushChunks: 0,
  };

  constructor(options: AudioChunkerOptions = {}) {
    const { onChunk, onError, onGap, ...rest } = options;

    this.options = {
      maxInFlight: rest.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT,
      maxRetries: rest.maxRetries ?? DEFAULT_MAX_RETRIES,
      chunkMs: rest.chunkMs ?? DEFAULT_CHUNK_MS,
      workletUrl: rest.workletUrl ?? AUDIO_WORKLET_URL,
      flushTimeoutMs: rest.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS,
    };

    if (!Number.isInteger(this.options.chunkMs) || this.options.chunkMs <= 0) {
      throw new RangeError(
        `AudioChunker: chunkMs inválido (${String(this.options.chunkMs)})`,
      );
    }

    this.flow = new ChunkFlowController({
      maxInFlight: this.options.maxInFlight,
      maxRetries: this.options.maxRetries,
    });
    this.handlers = { onChunk, onError, onGap };
  }

  /** `true` between a successful `start()` and `stop()`. */
  get isRunning(): boolean {
    return this.running;
  }

  /** `true` while the capture is paused (worklet still running, no chunks). */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Wall-clock time assigned to the chunk being delivered. Valid inside
   * `onChunk`; use it as `capturedAt` when building the wire `AudioChunkMeta`.
   */
  get capturedAt(): string | null {
    return this.lastChunkAt;
  }

  /**
   * Starts the capture pipeline for `stream`.
   *
   * Must be called from a user gesture (same click that authorized the
   * microphone). Throws `AudioChunkerError` with a stable `code` when the browser
   * cannot run an AudioWorklet — there is no silent `ScriptProcessor` fallback.
   */
  async start(
    stream: MediaStream,
    handlers: Partial<AudioChunkHandlers> = {},
  ): Promise<void> {
    if (this.running) {
      throw new AudioChunkerError(
        'ALREADY_RUNNING',
        'A captura de áudio já está em execução.',
      );
    }

    this.handlers = { ...this.handlers, ...handlers };

    if (typeof this.handlers.onChunk !== 'function') {
      throw new AudioChunkerError(
        'MISSING_HANDLER',
        'AudioChunker.start() exige um handler onChunk.',
      );
    }

    const audioTrack =
      typeof stream?.getAudioTracks === 'function'
        ? stream.getAudioTracks()[0]
        : undefined;

    if (!stream || !audioTrack) {
      throw new AudioChunkerError(
        'INVALID_STREAM',
        'O stream informado não possui trilha de áudio.',
      );
    }

    if (audioTrack.readyState === 'ended') {
      throw new AudioChunkerError(
        'INVALID_STREAM',
        'A trilha de áudio já foi encerrada. Inicie a captura novamente.',
      );
    }

    const AudioContextCtor = getAudioContextConstructor();

    if (!AudioContextCtor) {
      throw new AudioChunkerError(
        'UNSUPPORTED_AUDIO_CONTEXT',
        'Este navegador não suporta a Web Audio API necessária para processar o áudio.',
      );
    }

    let context: AudioContext;
    try {
      context = new AudioContextCtor({
        sampleRate: AUDIO_TARGET_SAMPLE_RATE,
        latencyHint: 'interactive',
      });
    } catch {
      // Some browsers reject the `sampleRate` option. Falling back to the
      // native rate is not a silent quality loss: the worklet resamples.
      try {
        context = new AudioContextCtor({ latencyHint: 'interactive' });
      } catch (error) {
        throw new AudioChunkerError(
          'UNSUPPORTED_AUDIO_CONTEXT',
          'Não foi possível criar o contexto de áudio do navegador.',
          { cause: error },
        );
      }
    }

    if (!context.audioWorklet) {
      await closeContextQuietly(context);
      throw new AudioChunkerError(
        'UNSUPPORTED_AUDIO_WORKLET',
        'Este navegador não suporta AudioWorklet, necessário para processar o áudio do microfone.',
      );
    }

    try {
      await context.audioWorklet.addModule(this.options.workletUrl);
    } catch (error) {
      await closeContextQuietly(context);
      throw new AudioChunkerError(
        'WORKLET_LOAD_FAILED',
        `Não foi possível carregar o processador de áudio (${this.options.workletUrl}).`,
        { cause: error },
      );
    }

    if (typeof AudioWorkletNode === 'undefined') {
      await closeContextQuietly(context);
      throw new AudioChunkerError(
        'UNSUPPORTED_AUDIO_WORKLET',
        'Este navegador não expõe AudioWorkletNode.',
      );
    }

    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(context, PCM_WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: {
          targetRate: AUDIO_TARGET_SAMPLE_RATE,
          chunkMs: this.options.chunkMs,
          // The worklet resamples from whatever rate the context really uses.
          sourceRate: context.sampleRate,
        },
      });
    } catch (error) {
      await closeContextQuietly(context);
      throw new AudioChunkerError(
        'WORKLET_LOAD_FAILED',
        'Não foi possível iniciar o processador de áudio.',
        { cause: error },
      );
    }

    let sourceNode: MediaStreamAudioSourceNode;
    try {
      // Only the audio track enters the graph.
      sourceNode = context.createMediaStreamSource(new MediaStream([audioTrack]));
    } catch (error) {
      node.port.close();
      await closeContextQuietly(context);
      throw new AudioChunkerError(
        'INVALID_STREAM',
        'Não foi possível conectar a trilha de áudio ao processador.',
        { cause: error },
      );
    }

    this.flow.reset();
    this.pendingBuffers.clear();
    this.counters.chunksEmitted = 0;
    this.counters.chunksAcked = 0;
    this.counters.chunksRetried = 0;
    this.counters.chunksDropped = 0;
    this.counters.samplesEmitted = 0;
    this.counters.clockSkips = 0;
    this.counters.clockOverlaps = 0;
    this.counters.workletErrors = 0;
    this.counters.invalidMessages = 0;
    this.counters.finalFlushChunks = 0;
    this.paused = false;
    this.pauseGapPending = false;
    this.flushWaiter = null;

    this.context = context;
    this.node = node;
    this.sourceNode = sourceNode;
    this.contextSampleRate = context.sampleRate;
    this.contextState = context.state;
    this.running = true;
    this.startedAt = new Date().toISOString();
    this.lastChunkAt = null;

    node.port.onmessage = this.handleWorkletMessage;
    node.onprocessorerror = () => {
      this.counters.workletErrors += 1;
      this.emitError(
        new AudioChunkerError(
          'WORKLET_RUNTIME_ERROR',
          'O processador de áudio falhou durante a captura.',
        ),
      );
    };

    sourceNode.connect(node);

    // The processor never writes to its output, so this sink is silent. It only
    // keeps the graph "pulled" by the destination (an AudioWorkletNode with no
    // downstream connection is not guaranteed to be processed). Nothing is
    // routed to the speakers, therefore no echo is produced.
    const sink = context.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(context.destination);
    this.silentSink = sink;

    context.onstatechange = () => {
      this.contextState = context.state;

      if (!this.running) {
        return;
      }

      if (context.state === 'closed') {
        this.emitError(
          new AudioChunkerError(
            'CONTEXT_CLOSED',
            'O contexto de áudio foi encerrado inesperadamente. A captura foi interrompida.',
          ),
        );
        this.running = false;
      }
    };

    // Called from the same user gesture that authorized the share, so the
    // context is allowed to start playing.
    try {
      if (context.state !== 'running') {
        await context.resume();
      }
    } catch (error) {
      this.emitError(
        new AudioChunkerError(
          'CONTEXT_RESUME_FAILED',
          'O áudio não pôde ser iniciado. Clique em "Iniciar escuta" novamente.',
          { cause: error },
        ),
      );
    }
  }

  /**
   * Stops emitting chunks while keeping the share and the sample clock alive.
   *
   * The worklet is asked to flush its residual audio first, so the partial
   * pre-pause chunk keeps its own `startSample` instead of being shifted after
   * the paused interval.
   */
  pause(): void {
    if (!this.running || this.paused) {
      return;
    }

    this.paused = true;
    this.pauseGapPending = true;
    this.postToWorklet({ type: 'flush' });
    this.postToWorklet({ type: 'pause' });
  }

  /**
   * Resumes the capture. Must be called from a user gesture handler: browsers
   * only resume a suspended `AudioContext` (Safari auto-suspends, Chrome suspends
   * a context created without activation) from user activation.
   *
   * Paused time is not compacted: on resume the worklet reports a jump in
   * `startSample`, which is reported to the transport as an explicit gap.
   */
  async resume(): Promise<void> {
    if (!this.running) {
      throw new AudioChunkerError(
        'NOT_RUNNING',
        'A captura não está em execução.',
      );
    }

    const context = this.context;

    if (context && context.state !== 'running') {
      try {
        await context.resume();
      } catch (error) {
        throw new AudioChunkerError(
          'CONTEXT_RESUME_FAILED',
          'Não foi possível retomar o áudio. É necessário um clique do usuário.',
          { cause: error },
        );
      }
    }

    this.paused = false;
    this.postToWorklet({ type: 'resume' });
  }

  /**
   * Stops the pipeline.
   *
   * - `flush: true` (default) asks the worklet for the last partial chunk,
   *   re-delivers any unacked chunk, then releases the graph.
   * - `flush: false` discards buffers (cancel), so pending audio is not sent.
   *
   * The `MediaStream` tracks are **not** stopped here: `AudioCapture` (micCapture) owns
   * them and stops them when the capture ends.
   */
  async stop(options: { flush?: boolean } = {}): Promise<void> {
    const flush = options.flush ?? true;

    if (!this.running) {
      return;
    }

    this.running = false;
    this.paused = false;

    if (flush) {
      this.flushing = true;
      try {
        await this.requestFinalFlush();
      } finally {
        this.flushing = false;
      }
    }

    this.teardownGraph();

    if (flush) {
      // Force a last delivery of everything still unacked. Those chunks stay
      // tracked by the controller, so a late ACK still resolves and a final
      // failure is reported as an explicit gap instead of silently vanishing.
      for (const chunk of this.flow.pendingChunks()) {
        const buffer = this.pendingBuffers.get(chunk.chunkSeq);
        if (!buffer) {
          continue;
        }
        this.counters.finalFlushChunks += 1;
        this.deliverChunk(chunk, buffer.slice(0));
      }
    } else {
      // Cancel: the session is being discarded, so pending audio must not be
      // sent and no gap is reported for a session that will not exist.
      this.flow.reset();
      this.pendingBuffers.clear();
    }

    this.contextState = 'closed';
    this.resolveFlushWaiter();
  }

  /**
   * ACKs a chunk. Returns `false` for unknown/repeated ids: a late ACK never
   * reopens a gap nor resurrects a dropped chunk.
   */
  ack(chunkSeq: number): boolean {
    const acked = this.flow.ack(chunkSeq);

    if (acked) {
      this.counters.chunksAcked += 1;
      this.pendingBuffers.delete(chunkSeq);
    }

    return acked;
  }

  /**
   * Reports a failed delivery. `retry` re-sends **the same** `chunkSeq` (the
   * backend deduplicates); after `maxRetries` the chunk is dropped and an
   * explicit gap is handed to `onGap`.
   */
  fail(chunkSeq: number): ChunkFailureResult {
    const result = this.flow.fail(chunkSeq);

    if (result.action === 'retry' && result.chunk) {
      this.counters.chunksRetried += 1;
      const stored = this.pendingBuffers.get(result.chunk.chunkSeq);
      if (stored) {
        this.deliverChunk(result.chunk, stored.slice(0));
      } else {
        this.emitError(
          new AudioChunkerError(
            'CHUNK_BUFFER_LOST',
            'O áudio do bloco pendente não está mais disponível para reenvio.',
          ),
        );
      }
      return result;
    }

    if (result.action === 'dropped' && result.chunk) {
      this.counters.chunksDropped += 1;
      this.pendingBuffers.delete(result.chunk.chunkSeq);
      if (result.gap) {
        this.reportGap(result.gap);
      }
    }

    return result;
  }

  /** Snapshot of the pipeline state (safe to poll for the UI/metrics). */
  getMetrics(): AudioChunkerMetrics {
    return {
      running: this.running,
      paused: this.paused,
      contextState: this.contextState,
      contextSampleRate: this.contextSampleRate,
      targetSampleRate: AUDIO_TARGET_SAMPLE_RATE,
      chunkMs: this.options.chunkMs,
      chunksEmitted: this.counters.chunksEmitted,
      chunksAcked: this.counters.chunksAcked,
      chunksRetried: this.counters.chunksRetried,
      chunksDropped: this.counters.chunksDropped,
      samplesEmitted: this.counters.samplesEmitted,
      nextChunkSeq: this.flow.nextChunkSeq,
      nextSample: this.flow.startSample,
      inFlight: this.flow.inFlightCount,
      maxInFlight: this.flow.maxInFlight,
      gaps: this.flow.getGap(),
      clockSkips: this.counters.clockSkips,
      clockOverlaps: this.counters.clockOverlaps,
      workletErrors: this.counters.workletErrors,
      invalidMessages: this.counters.invalidMessages,
      finalFlushChunks: this.counters.finalFlushChunks,
      startedAt: this.startedAt,
      lastChunkAt: this.lastChunkAt,
    };
  }

  private readonly handleWorkletMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;

    if (!isRecord(data) || typeof data.type !== 'string') {
      this.counters.invalidMessages += 1;
      return;
    }

    switch (data.type) {
      case 'chunk':
        this.handleChunkMessage(data);
        return;
      case 'flushed':
        this.resolveFlushWaiter();
        return;
      case 'error':
        this.counters.workletErrors += 1;
        this.emitError(
          new AudioChunkerError(
            'WORKLET_RUNTIME_ERROR',
            `O processador de áudio reportou um erro${
              typeof data.message === 'string' ? `: ${data.message}` : '.'
            }`,
          ),
        );
        return;
      default:
        return;
    }
  };

  private handleChunkMessage(data: Record<string, unknown>): void {
    // `flushing` keeps the final partial chunk coming after `running` is false.
    if (!this.running && !this.flushing) {
      return;
    }

    const message: WorkletChunkMessage = {
      type: 'chunk',
      buffer: data.buffer as ArrayBuffer,
      samples: typeof data.samples === 'number' ? data.samples : 0,
      startSample: typeof data.startSample === 'number' ? data.startSample : 0,
    };

    if (
      !isArrayBuffer(message.buffer) ||
      !Number.isInteger(message.samples) ||
      message.samples <= 0
    ) {
      this.counters.invalidMessages += 1;
      return;
    }

    this.syncClock(message.startSample);

    const descriptor = this.flow.beginChunk(message.samples);

    if (!descriptor) {
      // Saturated: the audio cannot be queued (that would grow without bound),
      // so it is reported as an explicit gap and the sample clock skips it.
      this.counters.chunksDropped += 1;
      for (const gap of this.flow.registerGap('saturated', message.samples)) {
        this.reportGap(gap);
      }
      return;
    }

    this.counters.chunksEmitted += 1;
    this.counters.samplesEmitted += message.samples;
    this.deliverChunk(descriptor, message.buffer);
  }

  /**
   * Keeps the controller clock aligned with the worklet media clock.
   *
   * The worklet clock keeps advancing while paused (audio is discarded, not
   * compacted), so a jump means real audio was not transmitted. It is reported
   * as a gap instead of being hidden.
   */
  private syncClock(payloadStartSample: number): void {
    if (!Number.isInteger(payloadStartSample) || payloadStartSample < 0) {
      this.counters.invalidMessages += 1;
      return;
    }

    const expected = this.flow.startSample;

    if (payloadStartSample === expected) {
      return;
    }

    if (payloadStartSample > expected) {
      this.counters.clockSkips += 1;
      const reason = this.pauseGapPending ? 'paused' : 'clock-skip';

      if (this.pauseGapPending) {
        this.pauseGapPending = false;
      }

      for (const gap of this.flow.registerGap(
        reason,
        payloadStartSample - expected,
      )) {
        this.reportGap(gap);
      }
      return;
    }

    // The worklet reported a chunk that overlaps audio already accounted for.
    // Keep the controller clock (never move it backwards).
    this.counters.clockOverlaps += 1;
  }

  private deliverChunk(descriptor: ChunkDescriptor, buffer: ArrayBuffer): void {
    const capturedAt = new Date().toISOString();
    this.lastChunkAt = capturedAt;

    // Keep a private copy: the consumer is allowed to transfer `buffer` (e.g.
    // postMessage), which would detach it and break retries.
    this.pendingBuffers.set(descriptor.chunkSeq, buffer.slice(0));

    const meta: AudioChunkMetaPayload = {
      chunkSeq: descriptor.chunkSeq,
      encoding: 'pcm16le',
      sampleRate: AUDIO_TARGET_SAMPLE_RATE,
      channels: 1,
      samples: descriptor.samples,
      startSample: descriptor.startSample,
    };

    try {
      this.handlers.onChunk?.(meta, buffer);
    } catch (error) {
      this.emitError(
        new AudioChunkerError(
          'CHUNK_HANDLER_FAILED',
          'O envio do bloco de áudio falhou.',
          { cause: error },
        ),
      );
    }
  }

  private reportGap(gap: GapRange): void {
    try {
      this.handlers.onGap?.(gap);
    } catch {
      // A broken gap handler must not stop the capture.
    }
  }

  private emitError(error: AudioChunkerError): void {
    try {
      this.handlers.onError?.(error);
    } catch {
      // A broken error handler must not stop the capture.
    }
  }

  private postToWorklet(message: Record<string, unknown>): void {
    const port = this.node?.port;

    if (!port) {
      return;
    }

    try {
      port.postMessage(message);
    } catch {
      // A closed port means the graph is already gone; nothing to signal.
    }
  }

  private requestFinalFlush(): Promise<void> {
    if (!this.node) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.flushWaiter = null;
        resolve();
      }, this.options.flushTimeoutMs);

      this.flushWaiter = () => {
        clearTimeout(timeout);
        this.flushWaiter = null;
        resolve();
      };

      this.postToWorklet({ type: 'flush' });
    });
  }

  private resolveFlushWaiter(): void {
    const waiter = this.flushWaiter;

    if (waiter) {
      this.flushWaiter = null;
      waiter();
    }
  }

  private teardownGraph(): void {
    const node = this.node;
    const sourceNode = this.sourceNode;
    const sink = this.silentSink;
    const context = this.context;

    this.node = null;
    this.sourceNode = null;
    this.silentSink = null;
    this.context = null;
    // `contextSampleRate` is kept on purpose: it is useful diagnostics after the
    // capture ended (e.g. "the browser ran at 48 kHz and the worklet resampled").

    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      try {
        node.port.close();
      } catch {
        // Port already closed.
      }
      try {
        node.disconnect();
      } catch {
        // Node already disconnected.
      }
    }

    try {
      sourceNode?.disconnect();
    } catch {
      // Node already disconnected.
    }

    try {
      sink?.disconnect();
    } catch {
      // Node already disconnected.
    }

    if (context) {
      context.onstatechange = null;
      void closeContextQuietly(context);
    }
  }
}
