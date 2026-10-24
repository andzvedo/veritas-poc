/**
 * Socket.IO wiring for live capture sessions.
 *
 * Validates client payloads against shared Zod contracts, owns session
 * isolation via {@link liveSessionRegistry}, and forwards typed server events.
 * Whisper.cpp / real audio are not exercised here — providers are injectable
 * (tests use scripted transcription fixtures).
 */
import type { Socket } from 'socket.io';
import {
  AUDIO_CHUNK_SCHEMA,
  CORRECT_TRANSCRIPT_SCHEMA,
  DELETE_SESSION_SCHEMA,
  EXPORT_SESSION_SCHEMA,
  LIVE_ID_SCHEMA,
  LIVE_PAYLOAD_LIMITS,
  LIVE_SESSION_CONTROL_SCHEMA,
  RESUME_SESSION_SCHEMA,
  RETRY_VERIFICATION_SCHEMA,
  START_LIVE_SESSION_SCHEMA,
  SUBMIT_HUMAN_REVIEW_SCHEMA,
  UPDATE_SPEAKER_MAPPING_SCHEMA,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@veritas/shared';
import { getAdvancedLLM, getLiteLLM } from '#/llm/index.js';
import {
  LivePipeline,
  type LivePipelineDeps,
  type LivePipelineEmit,
} from '#/live/livePipeline.js';
import {
  LiveSessionError,
  LiveSessionStateError,
  LiveSessionUnavailableError,
} from '#/live/liveSession.js';
import {
  createDiarizationProvider,
  SpeakerMappingConflictError,
  UnknownSpeakerError,
} from '#/live/speakerIdentification.js';
import {
  LiveSessionRegistry,
  liveSessionRegistry,
} from '#/live/sessionRegistry.js';
import { RevisionConflictError } from '#/live/revisionLedger.js';
import { createTranscriptionProvider } from '#/live/transcription.js';
import { SpeechSegmenterError } from '#/live/speechSegments.js';
import {
  DEFAULT_LIVE_RATE_LIMITS,
  TokenBucket,
  type LiveRateLimits,
} from '#/utils/rateLimit.js';
import { createTavilyProvider } from '#/research/tavily.js';
import { redactSecrets, safeErrorForLog } from '#/utils/security.js';

export type LiveHandlersOptions = {
  /** Override registry (tests). Defaults to the process-wide singleton. */
  registry?: LiveSessionRegistry;
  /** Injection point for transcription (tests use scripted fixtures). */
  createTranscription?: typeof createTranscriptionProvider;
  createDiarization?: typeof createDiarizationProvider;
  env?: NodeJS.ProcessEnv;
  /** Per-socket event limits (LIVE-038). Defaults to DEFAULT_LIVE_RATE_LIMITS. */
  rateLimits?: Partial<LiveRateLimits>;
  now?: () => number;
  /**
   * Extra LivePipeline deps for tests (extractClaimsFn, investigateClaimFn,
   * sessionConfig, etc.). Never used to inject credentials from env files.
   */
  pipelineOverrides?: Partial<
    Omit<
      LivePipelineDeps,
      'sessionId' | 'ownerSocketId' | 'source' | 'language' | 'emit'
    >
  >;
};

type LiveSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const emitLiveError = (
  socket: LiveSocket,
  sessionId: string | undefined,
  message: string,
): void => {
  socket.emit('LIVE_SESSION_STATE', {
    envelope: {
      protocolVersion: 1,
      eventId: `err-${Date.now().toString(36)}`,
      ...(sessionId === undefined ? {} : { sessionId }),
      eventSeq: 0,
      emittedAt: new Date().toISOString(),
    },
    data: {
      sessionId: sessionId ?? 'unknown',
      state: 'ERROR',
      reason: redactSecrets(message),
    },
  });
};

const bindEmit = (socket: LiveSocket): LivePipelineEmit => ({
  LIVE_SESSION_STARTED: (event) => {
    socket.emit('LIVE_SESSION_STARTED', event as never);
  },
  LIVE_SESSION_STATE: (event) => {
    socket.emit('LIVE_SESSION_STATE', event as never);
  },
  TRANSCRIPT_PARTIAL: (event) => {
    socket.emit('TRANSCRIPT_PARTIAL', event as never);
  },
  TRANSCRIPT_FINAL: (event) => {
    socket.emit('TRANSCRIPT_FINAL', event as never);
  },
  TRANSCRIPT_REVISED: (event) => {
    socket.emit('TRANSCRIPT_REVISED', event as never);
  },
  SPEAKER_MAPPING_UPDATED: (event) => {
    socket.emit('SPEAKER_MAPPING_UPDATED', event as never);
  },
  CLAIM_DETECTED: (event) => {
    socket.emit('CLAIM_DETECTED', event as never);
  },
  CLAIM_STATUS_UPDATED: (event) => {
    socket.emit('CLAIM_STATUS_UPDATED', event as never);
  },
  VERIFICATION_RESULT: (event) => {
    socket.emit('VERIFICATION_RESULT', event as never);
  },
  VERIFICATION_INVALIDATED: (event) => {
    socket.emit('VERIFICATION_INVALIDATED', event as never);
  },
  SESSION_SNAPSHOT: (event) => {
    socket.emit('SESSION_SNAPSHOT', event as never);
  },
  LIVE_METRICS: (event) => {
    socket.emit('LIVE_METRICS', event as never);
  },
  LIVE_GAP: (event) => {
    socket.emit('LIVE_GAP', event as never);
  },
  LIVE_SESSION_ENDED: (event) => {
    socket.emit('LIVE_SESSION_ENDED', event as never);
  },
  AUDIO_CHUNK_ACK: (event) => {
    socket.emit('AUDIO_CHUNK_ACK', event as never);
  },
  SESSION_EXPORT: (event) => {
    socket.emit('SESSION_EXPORT', event as never);
  },
  HUMAN_REVIEW_RECORDED: (event) => {
    socket.emit('HUMAN_REVIEW_RECORDED', event as never);
  },
});

/** sessionId of an untrusted payload, only when it is a valid id. */
const sessionIdOf = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const parsed = LIVE_ID_SCHEMA.safeParse(
    (payload as { sessionId?: unknown }).sessionId,
  );
  return parsed.success ? parsed.data : undefined;
};

/** Messages of these errors are written for the user and contain no secrets. */
const userFacingMessage = (error: unknown, fallback: string): string =>
  error instanceof LiveSessionError ||
  error instanceof RevisionConflictError ||
  error instanceof SpeechSegmenterError ||
  error instanceof UnknownSpeakerError ||
  error instanceof SpeakerMappingConflictError
    ? error.message
    : fallback;

const requireOwned = (
  registry: LiveSessionRegistry,
  socket: LiveSocket,
  sessionId: string,
): LivePipeline | undefined => {
  const pipeline = registry.getOwned(sessionId, socket.id);
  if (pipeline === undefined) {
    emitLiveError(
      socket,
      sessionId,
      'Sessão ao vivo não encontrada ou sem autorização nesta conexão.',
    );
    return undefined;
  }
  return pipeline;
};

const MAX_CHUNK_BYTES = LIVE_PAYLOAD_LIMITS.maxChunkSamples * 2;

/**
 * Binary guard: only Buffer / ArrayBuffer / typed views up to the chunk cap
 * are accepted. Anything else (strings, objects, oversize) returns undefined.
 */
export const toPcmBuffer = (audio: unknown): Buffer | undefined => {
  let buffer: Buffer | undefined;
  if (Buffer.isBuffer(audio)) {
    buffer = audio;
  } else if (audio instanceof ArrayBuffer) {
    buffer = Buffer.from(audio);
  } else if (ArrayBuffer.isView(audio)) {
    buffer = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  }
  if (
    buffer === undefined ||
    buffer.byteLength === 0 ||
    buffer.byteLength > MAX_CHUNK_BYTES ||
    buffer.byteLength % 2 !== 0
  ) {
    return undefined;
  }
  return buffer;
};

/**
 * Registers every live client→server listener on one socket.
 * Safe to call alongside the existing REQUEST_FACT_CHECK handler.
 */
export function attachLiveSessionHandlers(
  socket: LiveSocket,
  options: LiveHandlersOptions = {},
): void {
  const registry = options.registry ?? liveSessionRegistry;
  const createTranscription =
    options.createTranscription ?? createTranscriptionProvider;
  const createDiarization =
    options.createDiarization ?? createDiarizationProvider;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const limits = { ...DEFAULT_LIVE_RATE_LIMITS, ...(options.rateLimits ?? {}) };
  const buckets = {
    audio: new TokenBucket({ ...limits.audio, now }),
    control: new TokenBucket({ ...limits.control, now }),
    session: new TokenBucket({ ...limits.session, now }),
  };
  let lastLimitNoticeAt = Number.NEGATIVE_INFINITY;
  /** False when the socket exceeded its budget (one notice per second). */
  const allow = (kind: keyof typeof buckets, payload: unknown): boolean => {
    if (buckets[kind].tryTake()) {
      return true;
    }
    const at = now();
    if (at - lastLimitNoticeAt >= 1_000) {
      lastLimitNoticeAt = at;
      emitLiveError(
        socket,
        sessionIdOf(payload),
        'Limite de eventos excedido nesta conexão; aguarde antes de reenviar.',
      );
    }
    return false;
  };
  /** Handlers never throw into Socket.IO (malformed input, state errors). */
  const guard =
    <A extends unknown[]>(name: string, handler: (...args: A) => void) =>
    (...args: A): void => {
      try {
        handler(...args);
      } catch (error) {
        console.error(`${name} handler failed`, {
          error: safeErrorForLog(error),
        });
        emitLiveError(
          socket,
          sessionIdOf(args[0]),
          userFacingMessage(error, 'Falha ao processar o evento ao vivo.'),
        );
      }
    };

  socket.on('disconnect', () => {
    registry.markSocketDisconnected(socket.id);
  });

  socket.on('START_LIVE_SESSION', (payload) => {
    if (!allow('session', payload)) {
      return;
    }
    void (async () => {
      const parsed = START_LIVE_SESSION_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        emitLiveError(
          socket,
          sessionIdOf(payload),
          'Payload START_LIVE_SESSION inválido.',
        );
        return;
      }
      const data = parsed.data;
      try {
        const googleKey = data.apiKeys?.google?.trim() ?? '';
        const tavilyKey = data.apiKeys?.tavily?.trim() ?? '';
        const transcription = await createTranscription({
          googleApiKey: googleKey.length > 0 ? googleKey : undefined,
          env,
        });
        const diarization = createDiarization(env);

        const overrides = options.pipelineOverrides ?? {};
        const pipeline = new LivePipeline({
          sessionId: data.sessionId,
          ownerSocketId: socket.id,
          source: data.source,
          language: data.language,
          transcription: overrides.transcription ?? transcription,
          diarization: overrides.diarization ?? diarization,
          emit: bindEmit(socket),
          apiKeys: {
            ...(googleKey.length > 0 ? { google: googleKey } : {}),
            ...(tavilyKey.length > 0 ? { tavily: tavilyKey } : {}),
            ...overrides.apiKeys,
          },
          ...(googleKey.length > 0
            ? {
                extractionLlm: getLiteLLM(googleKey),
                evaluationLlm: getAdvancedLLM(googleKey),
              }
            : {}),
          ...(tavilyKey.length > 0
            ? { researchProvider: createTavilyProvider({ apiKey: tavilyKey }) }
            : {}),
          ...overrides,
        });

        const resumeToken = registry.register(pipeline);
        try {
          pipeline.start(resumeToken);
        } catch (error) {
          pipeline.cancel('start_failed');
          registry.remove(pipeline.sessionId);
          throw error;
        }
      } catch (error) {
        console.error('START_LIVE_SESSION failed', {
          sessionId: data.sessionId,
          error: safeErrorForLog(error),
        });
        const message =
          error instanceof LiveSessionUnavailableError ||
          error instanceof LiveSessionStateError
            ? error.message
            : 'Não foi possível iniciar a sessão ao vivo.';
        emitLiveError(socket, data.sessionId, message);
      }
    })().catch((error: unknown) => {
      emitLiveError(
        socket,
        sessionIdOf(payload),
        userFacingMessage(error, 'Falha ao processar o evento ao vivo.'),
      );
    });
  });

  socket.on(
    'AUDIO_CHUNK',
    guard('AUDIO_CHUNK', (payload: unknown, audio: unknown) => {
      if (!allow('audio', payload)) {
        return;
      }
      const parsed = AUDIO_CHUNK_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pcm = toPcmBuffer(audio);
      if (pcm === undefined) {
        emitLiveError(
          socket,
          parsed.data.sessionId,
          'Chunk de áudio inválido (binário ausente, vazio ou acima do limite).',
        );
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      const { sessionId, ...meta } = parsed.data;
      void sessionId;
      pipeline.handleAudioChunk(meta, pcm);
    }),
  );

  socket.on(
    'PAUSE_LIVE_SESSION',
    guard('PAUSE_LIVE_SESSION', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = LIVE_SESSION_CONTROL_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      try {
        pipeline.pause();
      } catch (error) {
        emitLiveError(
          socket,
          parsed.data.sessionId,
          userFacingMessage(error, 'Falha ao pausar'),
        );
      }
    }),
  );

  socket.on(
    'RESUME_LIVE_SESSION',
    guard('RESUME_LIVE_SESSION', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = LIVE_SESSION_CONTROL_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      try {
        pipeline.resumeCapture();
      } catch (error) {
        emitLiveError(
          socket,
          parsed.data.sessionId,
          userFacingMessage(error, 'Falha ao retomar'),
        );
      }
    }),
  );

  socket.on('END_LIVE_SESSION', (payload) => {
    if (!allow('control', payload)) {
      return;
    }
    void (async () => {
      const parsed = LIVE_SESSION_CONTROL_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      try {
        await pipeline.end('requested');
      } catch (error) {
        emitLiveError(
          socket,
          parsed.data.sessionId,
          userFacingMessage(error, 'Falha ao encerrar'),
        );
      } finally {
        registry.remove(parsed.data.sessionId);
      }
    })().catch((error: unknown) => {
      emitLiveError(
        socket,
        sessionIdOf(payload),
        userFacingMessage(error, 'Falha ao processar o evento ao vivo.'),
      );
    });
  });

  socket.on(
    'CANCEL_LIVE_SESSION',
    guard('CANCEL_LIVE_SESSION', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = LIVE_SESSION_CONTROL_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      pipeline.cancel('cancelled');
      registry.remove(parsed.data.sessionId);
    }),
  );

  socket.on(
    'RESUME_SESSION',
    guard('RESUME_SESSION', (payload: unknown) => {
      if (!allow('session', payload)) {
        return;
      }
      const parsed = RESUME_SESSION_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = registry.reclaim(
        parsed.data.sessionId,
        socket.id,
        parsed.data.resumeToken,
      );
      if (pipeline === undefined) {
        // Same message for unknown, expired and unauthorized sessions: the
        // response never confirms that another user's sessionId exists.
        emitLiveError(
          socket,
          parsed.data.sessionId,
          'Sessão ao vivo indisponível nesta instância ou sem autorização (sem persistência durável). Inicie uma nova sessão.',
        );
        return;
      }
      pipeline.setEmit(bindEmit(socket));
      try {
        pipeline.resumeSession(parsed.data.cursor);
      } catch (error) {
        emitLiveError(
          socket,
          parsed.data.sessionId,
          userFacingMessage(error, 'Falha ao retomar sessão'),
        );
      }
    }),
  );

  socket.on(
    'UPDATE_SPEAKER_MAPPING',
    guard('UPDATE_SPEAKER_MAPPING', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = UPDATE_SPEAKER_MAPPING_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      try {
        pipeline.updateSpeakerMappings(
          parsed.data.mappings,
          parsed.data.expectedRevision,
        );
      } catch (error) {
        const message =
          error instanceof UnknownSpeakerError ||
          error instanceof SpeakerMappingConflictError
            ? error.message
            : 'Falha ao atualizar mapeamento de locutores';
        emitLiveError(socket, parsed.data.sessionId, message);
      }
    }),
  );

  socket.on(
    'CORRECT_TRANSCRIPT',
    guard('CORRECT_TRANSCRIPT', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = CORRECT_TRANSCRIPT_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      try {
        pipeline.correctTranscript(
          parsed.data.segmentId,
          parsed.data.text,
          parsed.data.expectedRevision,
        );
      } catch (error) {
        emitLiveError(
          socket,
          parsed.data.sessionId,
          userFacingMessage(error, 'Falha ao corrigir transcrição'),
        );
      }
    }),
  );

  socket.on('RETRY_VERIFICATION', (payload) => {
    if (!allow('control', payload)) {
      return;
    }
    void (async () => {
      const parsed = RETRY_VERIFICATION_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const target = registry.findOwnedByVerification(
        socket.id,
        parsed.data.verificationId,
      );
      if (target === undefined) {
        emitLiveError(
          socket,
          undefined,
          'Verificação não encontrada nas sessões desta conexão.',
        );
        return;
      }
      try {
        await target.retryVerification(parsed.data.verificationId);
      } catch (error) {
        emitLiveError(
          socket,
          target.sessionId,
          userFacingMessage(error, 'Falha ao retentar verificação'),
        );
      }
    })().catch((error: unknown) => {
      emitLiveError(
        socket,
        sessionIdOf(payload),
        userFacingMessage(error, 'Falha ao processar o evento ao vivo.'),
      );
    });
  });

  socket.on(
    'EXPORT_SESSION',
    guard('EXPORT_SESSION', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = EXPORT_SESSION_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      pipeline.exportSession();
    }),
  );

  socket.on(
    'SUBMIT_HUMAN_REVIEW',
    guard('SUBMIT_HUMAN_REVIEW', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = SUBMIT_HUMAN_REVIEW_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        emitLiveError(
          socket,
          sessionIdOf(payload),
          'Payload SUBMIT_HUMAN_REVIEW inválido.',
        );
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      try {
        pipeline.submitHumanReview({
          verificationId: parsed.data.verificationId,
          expectedRevision: parsed.data.expectedRevision,
          decision: parsed.data.decision,
          ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
        });
      } catch (error) {
        emitLiveError(
          socket,
          parsed.data.sessionId,
          userFacingMessage(error, 'Falha ao registrar revisão humana'),
        );
      }
    }),
  );

  socket.on(
    'DELETE_SESSION',
    guard('DELETE_SESSION', (payload: unknown) => {
      if (!allow('control', payload)) {
        return;
      }
      const parsed = DELETE_SESSION_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
      if (pipeline === undefined) {
        return;
      }
      pipeline.deleteSession('deleted');
      registry.remove(parsed.data.sessionId);
    }),
  );
}
