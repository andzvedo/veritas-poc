/**
 * Orchestrates microphone capture + AudioChunker + live WebSocket session
 * (LIVE-007/025). Capture source switched from tab sharing to microphone on
 * 2026-10-23 (user decision).
 *
 * Starts only from an explicit user click. Never auto-recaptures when the
 * microphone is unplugged — only PCM audio chunks are forwarded.
 */

import type {
  AudioChunkRejectionReason,
  LiveSessionErrorCode,
  LiveSessionState,
} from '@veritas/shared';
import type { AudioChunkMetaPayload } from '@/lib/audio/audioStream';
import { AudioChunker, AudioChunkerError } from '@/lib/audio/audioStream';
import type { GapRange } from '@/lib/audio/flowControl';
import {
  MicCaptureError,
  startMicCapture,
  type AudioCapture,
  type MicCaptureMessages,
} from '@/lib/audio/micCapture';
import { factCheckService } from '@/lib/services/factCheckService';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { captureFeedbackFromErrorCode } from '@/lib/live/liveUiState';

export interface LiveSessionStartOptions {
  apiKeys?: { google?: string; tavily?: string };
  language?: 'pt-BR';
  /** Injected for tests. */
  createSessionId?: () => string;
  /** Microphone to use; empty/undefined = system default. */
  deviceId?: string;
  /** Localized capture error messages (`t.live.micErrors`). */
  micMessages?: Partial<MicCaptureMessages>;
  /** Injected for tests — skip real getUserMedia. */
  startCapture?: () => Promise<AudioCapture>;
  /** Injected for tests. */
  createChunker?: () => AudioChunker;
  /** How long to wait for LIVE_SESSION_STARTED before giving up. */
  startTimeoutMs?: number;
}

const DEFAULT_START_TIMEOUT_MS = 15_000;

/**
 * The backend refused or never confirmed the live session. `code` lets the UI
 * show actionable, localized copy (e.g. TRANSCRIPTION_UNAVAILABLE).
 */
export class LiveSessionStartError extends Error {
  readonly code: LiveSessionErrorCode | undefined;

  constructor(message: string, code?: LiveSessionErrorCode) {
    super(message);
    this.name = 'LiveSessionStartError';
    this.code = code;
  }
}

export type ChunkAckAction = 'ack' | 'retry' | 'drop';

/**
 * What to do with an AUDIO_CHUNK_ACK.
 * - `duplicate` / `overlap`: the server already holds that audio → settled.
 * - any other explicit reason (`not_listening`, `ended`, `rate_limited`, …)
 *   is definitive: resending the same chunk is rejected again and, at 10
 *   chunks/s × 4 attempts, trips the server rate limit (the old gap storm).
 * - no reason (legacy backend): bounded retry.
 */
export function classifyChunkAck(
  accepted: boolean,
  reason?: AudioChunkRejectionReason,
): ChunkAckAction {
  if (accepted) return 'ack';
  if (reason === 'duplicate' || reason === 'overlap') return 'ack';
  if (reason === undefined) return 'retry';
  return 'drop';
}

const STARTED_STATES: ReadonlySet<LiveSessionState> = new Set([
  'LISTENING',
  'PAUSED',
  'RECONNECTING',
]);

export type LiveSessionControllerPhase =
  | 'idle'
  | 'starting'
  | 'running'
  | 'reconnecting'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

function defaultSessionId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `live-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LiveSessionController {
  private capture: AudioCapture | null = null;
  private chunker: AudioChunker | null = null;
  private sessionId: string | null = null;
  private phase: LiveSessionControllerPhase = 'idle';
  private unsubscribeAck: (() => void) | null = null;
  private unbindCaptureEnded: (() => void) | null = null;
  private unbindCaptureError: (() => void) | null = null;
  private unsubscribeServerState: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private lastCaptureError: MicCaptureError | null = null;

  getPhase(): LiveSessionControllerPhase {
    return this.phase;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  async start(options: LiveSessionStartOptions = {}): Promise<string> {
    if (
      this.phase === 'starting' ||
      this.phase === 'running' ||
      this.phase === 'reconnecting' ||
      this.phase === 'paused'
    ) {
      throw new Error('Uma sessão Live já está em andamento.');
    }

    const store = useFactCheckStore.getState();
    store.reset();
    store.setCaptureFeedback('requesting_permission');
    this.lastCaptureError = null;
    this.phase = 'starting';

    const sessionId = (options.createSessionId ?? defaultSessionId)();
    this.sessionId = sessionId;

    try {
      await factCheckService.ensureConnected();
    } catch (error) {
      this.failLocal(
        'connection_error',
        error instanceof Error
          ? error.message
          : 'Não foi possível conectar ao servidor.',
      );
      throw error;
    }

    let capture: AudioCapture;
    try {
      const startCapture =
        options.startCapture ??
        (() =>
          startMicCapture({
            deviceId: options.deviceId,
            messages: options.micMessages,
          }));
      capture = await startCapture();
    } catch (error) {
      this.handleCaptureStartError(error);
      throw error;
    }

    this.capture = capture;
    store.update({ sessionId });
    store.setLiveSessionState('CONNECTING');
    store.setStatus('processing', 'CONNECTING');

    this.unbindCaptureEnded = capture.onEnded(() => {
      void this.handleCaptureEnded();
    });
    this.unbindCaptureError = capture.onError((error) => {
      this.lastCaptureError = error;
      store.setCaptureFeedback(
        captureFeedbackFromErrorCode(error.code),
        error.message,
      );
    });

    // Ask the server first and wait for its answer: audio sent before the
    // session exists is rejected (SESSION_NOT_FOUND, no ACK), and when the
    // backend has no transcriber it refuses the session up front.
    factCheckService.startLiveSession({
      sessionId,
      source: 'MIC',
      language: options.language ?? 'pt-BR',
      consent: true,
      apiKeys: options.apiKeys,
    });

    try {
      await this.waitForServerStart(
        options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
      );
    } catch (error) {
      await this.teardownCapture({ flush: false });
      this.phase = 'error';
      this.sessionId = null;
      const current = useFactCheckStore.getState();
      if (current.liveSessionState !== 'ERROR') {
        // Timeout / unexpected end: surface it as a coded session error.
        current.setLiveSessionState('ERROR', {
          reason: error instanceof Error ? error.message : String(error),
          code:
            error instanceof LiveSessionStartError
              ? error.code
              : 'START_FAILED',
        });
      }
      current.setCaptureFeedback('ended');
      throw error;
    }

    const chunker = options.createChunker?.() ?? new AudioChunker();
    this.chunker = chunker;

    this.unsubscribeAck = factCheckService.onAudioChunkAck(
      (chunkSeq, accepted, reason) => {
        if (!this.chunker) return;
        switch (classifyChunkAck(accepted, reason)) {
          case 'ack':
            // `duplicate`/`overlap` settle the slot too: the audio is there.
            this.chunker.ack(chunkSeq);
            return;
          case 'retry':
            this.chunker.fail(chunkSeq);
            return;
          case 'drop':
            this.chunker.drop(chunkSeq, reason ?? 'rejected');
            return;
        }
      },
    );

    try {
      await chunker.start(capture.stream, {
        onChunk: (meta, buffer) => this.emitChunk(meta, buffer),
        onError: (error) => {
          store.setCaptureFeedback(
            captureFeedbackFromErrorCode(error.code),
            error.message,
          );
        },
        onGap: (gap) => this.emitGap(gap),
      });
    } catch (error) {
      await this.teardownCapture({ flush: false });
      factCheckService.cancelLiveSession({ sessionId });
      this.handleCaptureStartError(error);
      throw error;
    }

    store.setCaptureFeedback('capturing');
    this.phase = 'running';
    this.unsubscribeConnection = factCheckService.onConnectionState(
      (connected) => {
        if (connected || this.phase !== 'running') return;
        this.phase = 'reconnecting';
        this.chunker?.pause();
        const current = useFactCheckStore.getState();
        current.setCaptureFeedback('capturing');
        current.setLiveSessionState('RECONNECTING');
      },
    );
    this.unsubscribeServerState = useFactCheckStore.subscribe((next, prev) => {
      if (next.liveSessionState !== prev.liveSessionState) {
        if (
          this.phase === 'reconnecting' &&
          prev.liveSessionState === 'RECONNECTING' &&
          next.liveSessionState === 'PAUSED' &&
          this.sessionId
        ) {
          // RESUME_SESSION restores a consistent snapshot in PAUSED first.
          // Ask the server to listen before the audio worklet resumes sending.
          factCheckService.resumeLiveSession({ sessionId: this.sessionId });
        } else if (
          this.phase === 'reconnecting' &&
          next.liveSessionState === 'LISTENING'
        ) {
          void this.finishReconnect();
        }
      }
      if (
        next.liveSessionState === 'ERROR' ||
        next.liveSessionState === 'ENDED'
      ) {
        void this.handleServerTerminal(next.liveSessionState);
      }
    });
    return sessionId;
  }

  /**
   * Resolves on LIVE_SESSION_STARTED (server state LISTENING); rejects with
   * the server's coded ERROR, an unexpected end, or a timeout.
   */
  private waitForServerStart(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let unsubscribe: () => void = () => {};
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error);
        else resolve();
      };
      const check = (state: ReturnType<typeof useFactCheckStore.getState>) => {
        const live = state.liveSessionState;
        if (live !== null && STARTED_STATES.has(live)) {
          finish();
        } else if (live === 'ERROR') {
          finish(
            new LiveSessionStartError(
              state.error ?? 'O servidor recusou a sessão ao vivo.',
              state.liveErrorCode ?? undefined,
            ),
          );
        } else if (live === 'ENDED') {
          finish(
            new LiveSessionStartError(
              'A sessão ao vivo foi encerrada pelo servidor antes de começar.',
              'START_FAILED',
            ),
          );
        }
      };
      const timer = setTimeout(() => {
        finish(
          new LiveSessionStartError(
            'O servidor não confirmou o início da sessão ao vivo a tempo.',
            'START_FAILED',
          ),
        );
      }, timeoutMs);
      unsubscribe = useFactCheckStore.subscribe((state) => check(state));
      check(useFactCheckStore.getState());
    });
  }

  /**
   * The server ended or failed the session while we were capturing (e.g. the
   * transcriber died mid-session). Release the microphone right away instead
   * of streaming chunks that will only be rejected (and become gaps).
   */
  private async handleServerTerminal(state: 'ERROR' | 'ENDED'): Promise<void> {
    if (
      this.phase !== 'running' &&
      this.phase !== 'reconnecting' &&
      this.phase !== 'paused'
    )
      return;
    this.phase = state === 'ERROR' ? 'error' : 'stopped';
    this.sessionId = null;
    await this.teardownCapture({ flush: false });
    useFactCheckStore.getState().setCaptureFeedback('ended');
  }

  private async finishReconnect(): Promise<void> {
    if (this.phase !== 'reconnecting' || !this.chunker) return;
    try {
      await this.chunker.resume();
      this.phase = 'running';
      const store = useFactCheckStore.getState();
      store.setCaptureFeedback('capturing');
    } catch (error) {
      this.phase = 'error';
      this.sessionId = null;
      await this.teardownCapture({ flush: false });
      const store = useFactCheckStore.getState();
      store.setCaptureFeedback(
        'connection_error',
        error instanceof Error
          ? error.message
          : 'Não foi possível retomar a captura após a reconexão.',
      );
      store.setLiveSessionState('ERROR', {
        reason: error instanceof Error ? error.message : String(error),
        code: 'START_FAILED',
      });
    }
  }

  async pause(): Promise<void> {
    if (!this.sessionId || !this.chunker) return;
    this.chunker.pause();
    factCheckService.pauseLiveSession({ sessionId: this.sessionId });
    useFactCheckStore.getState().setCaptureFeedback('paused');
    useFactCheckStore.getState().setLiveSessionState('PAUSED');
    this.phase = 'paused';
  }

  async resume(): Promise<void> {
    if (!this.sessionId || !this.chunker) return;
    await this.chunker.resume();
    factCheckService.resumeLiveSession({ sessionId: this.sessionId });
    useFactCheckStore.getState().setCaptureFeedback('capturing');
    useFactCheckStore.getState().setLiveSessionState('LISTENING');
    this.phase = 'running';
  }

  async stop(options: { cancel?: boolean } = {}): Promise<void> {
    if (this.phase === 'idle' || this.phase === 'stopped') return;

    this.phase = 'stopping';
    const store = useFactCheckStore.getState();
    store.setCaptureFeedback('ending');
    store.setLiveSessionState('ENDING');

    const sessionId = this.sessionId;
    await this.teardownCapture({ flush: !options.cancel });

    if (sessionId) {
      if (options.cancel) {
        factCheckService.cancelLiveSession({ sessionId });
      } else {
        factCheckService.endLiveSession({ sessionId });
      }
    }

    store.setCaptureFeedback('ended');
    store.setLiveSessionState('ENDED');
    this.phase = 'stopped';
    this.sessionId = null;
  }

  private emitChunk(meta: AudioChunkMetaPayload, buffer: ArrayBuffer): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;

    const capturedAt = this.chunker?.capturedAt ?? new Date().toISOString();

    try {
      factCheckService.sendAudioChunk(
        {
          sessionId,
          chunkSeq: meta.chunkSeq,
          encoding: meta.encoding,
          sampleRate: meta.sampleRate,
          channels: meta.channels,
          samples: meta.samples,
          startSample: meta.startSample,
          capturedAt,
        },
        buffer,
      );
    } catch (error) {
      this.chunker?.fail(meta.chunkSeq);
      useFactCheckStore
        .getState()
        .setCaptureFeedback(
          'connection_error',
          error instanceof Error ? error.message : 'Falha ao enviar áudio.',
        );
    }
  }

  private emitGap(gap: GapRange): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    useFactCheckStore.getState().pushLiveGap({
      sessionId,
      fromSample: gap.fromSample,
      toSample: gap.toSample,
      reason: gap.reason,
    });
  }

  /**
   * Microphone ended on its own (unplugged / permission revoked). The capture
   * already reported the localized DEVICE_DISCONNECTED message through
   * `onError`; close the session gracefully (flush + end) without retrying.
   */
  private async handleCaptureEnded(): Promise<void> {
    if (this.phase === 'stopping' || this.phase === 'stopped') return;
    const reason = this.lastCaptureError;
    await this.stop();
    if (reason) {
      // Keep the "microphone disconnected" message visible after the session
      // closed (the `ended` tone hides errors); the user restarts manually.
      useFactCheckStore
        .getState()
        .setCaptureFeedback(
          captureFeedbackFromErrorCode(reason.code),
          reason.message,
        );
    }
  }

  private handleCaptureStartError(error: unknown): void {
    if (
      error instanceof MicCaptureError ||
      error instanceof AudioChunkerError
    ) {
      this.failLocal(captureFeedbackFromErrorCode(error.code), error.message);
      return;
    }
    this.failLocal(
      'connection_error',
      error instanceof Error ? error.message : 'Falha ao iniciar a captura.',
    );
  }

  private failLocal(
    feedback: ReturnType<typeof captureFeedbackFromErrorCode>,
    message: string,
  ): void {
    useFactCheckStore.getState().setCaptureFeedback(feedback, message);
    this.phase = 'error';
    this.sessionId = null;
  }

  private async teardownCapture(options: { flush: boolean }): Promise<void> {
    this.unsubscribeServerState?.();
    this.unsubscribeServerState = null;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    this.unbindCaptureEnded?.();
    this.unbindCaptureEnded = null;
    this.unbindCaptureError?.();
    this.unbindCaptureError = null;
    this.unsubscribeAck?.();
    this.unsubscribeAck = null;

    if (this.chunker) {
      try {
        await this.chunker.stop({ flush: options.flush });
      } catch {
        // Teardown must not throw — the mic track still needs release.
      }
      this.chunker = null;
    }

    if (this.capture) {
      this.capture.stop();
      this.capture = null;
    }
  }
}

/** Singleton used by the Live UI. */
export const liveSessionController = new LiveSessionController();
