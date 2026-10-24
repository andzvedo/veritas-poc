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
  LIVE_SESSION_CONTROL_SCHEMA,
  RESUME_SESSION_SCHEMA,
  RETRY_VERIFICATION_SCHEMA,
  START_LIVE_SESSION_SCHEMA,
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
import { createTranscriptionProvider } from '#/live/transcription.js';
import { createTavilyProvider } from '#/research/tavily.js';
import { redactSecrets, safeErrorForLog } from '#/utils/security.js';

export type LiveHandlersOptions = {
  /** Override registry (tests). Defaults to the process-wide singleton. */
  registry?: LiveSessionRegistry;
  /** Injection point for transcription (tests use scripted fixtures). */
  createTranscription?: typeof createTranscriptionProvider;
  createDiarization?: typeof createDiarizationProvider;
  env?: NodeJS.ProcessEnv;
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
});

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

const toPcmBuffer = (audio: unknown): Buffer | undefined => {
  if (Buffer.isBuffer(audio)) {
    return audio;
  }
  if (typeof ArrayBuffer !== 'undefined' && audio instanceof ArrayBuffer) {
    return Buffer.from(audio);
  }
  if (audio instanceof Uint8Array) {
    return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  }
  return undefined;
};

const sessionIdFromPayload = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const sessionId = (payload as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' ? sessionId : undefined;
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

  socket.on('disconnect', () => {
    registry.markSocketDisconnected(socket.id);
  });

  socket.on('START_LIVE_SESSION', (payload) => {
    void (async () => {
      const parsed = START_LIVE_SESSION_SCHEMA.safeParse(payload);
      if (!parsed.success) {
        emitLiveError(
          socket,
          sessionIdFromPayload(payload),
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

        registry.register(pipeline);
        pipeline.start();
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
        sessionIdFromPayload(payload),
        error instanceof Error
          ? error.message
          : 'Não foi possível iniciar a sessão ao vivo.',
      );
    });
  });

  socket.on('AUDIO_CHUNK', (payload, audio) => {
    const parsed = AUDIO_CHUNK_SCHEMA.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
    if (pipeline === undefined) {
      return;
    }
    const pcm = toPcmBuffer(audio);
    if (pcm === undefined || pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
      emitLiveError(
        socket,
        parsed.data.sessionId,
        'Chunk de áudio inválido: esperado PCM16LE binário com tamanho par.',
      );
      return;
    }
    const { sessionId, ...meta } = parsed.data;
    void sessionId;
    try {
      pipeline.handleAudioChunk(meta, pcm);
    } catch (error) {
      emitLiveError(
        socket,
        parsed.data.sessionId,
        error instanceof Error ? error.message : 'Falha ao processar áudio.',
      );
    }
  });

  socket.on('PAUSE_LIVE_SESSION', (payload) => {
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
        error instanceof Error ? error.message : 'Falha ao pausar',
      );
    }
  });

  socket.on('RESUME_LIVE_SESSION', (payload) => {
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
        error instanceof Error ? error.message : 'Falha ao retomar',
      );
    }
  });

  socket.on('END_LIVE_SESSION', (payload) => {
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
          error instanceof Error ? error.message : 'Falha ao encerrar',
        );
      } finally {
        registry.remove(parsed.data.sessionId);
      }
    })().catch((error: unknown) => {
      emitLiveError(
        socket,
        sessionIdFromPayload(payload),
        error instanceof Error ? error.message : 'Falha ao encerrar sessão.',
      );
    });
  });

  socket.on('CANCEL_LIVE_SESSION', (payload) => {
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
  });

  socket.on('RESUME_SESSION', (payload) => {
    const parsed = RESUME_SESSION_SCHEMA.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const pipeline = registry.reclaim(parsed.data.sessionId, socket.id);
    if (pipeline === undefined) {
      emitLiveError(
        socket,
        parsed.data.sessionId,
        'Sessão ao vivo indisponível nesta instância (sem persistência durável). Inicie uma nova sessão.',
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
        error instanceof Error ? error.message : 'Falha ao retomar sessão',
      );
    }
  });

  socket.on('UPDATE_SPEAKER_MAPPING', (payload) => {
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
  });

  socket.on('CORRECT_TRANSCRIPT', (payload) => {
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
        error instanceof Error
          ? error.message
          : 'Falha ao corrigir transcrição',
      );
    }
  });

  socket.on('RETRY_VERIFICATION', (payload) => {
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
          error instanceof Error
            ? error.message
            : 'Falha ao retentar verificação',
        );
      }
    })().catch((error: unknown) => {
      emitLiveError(
        socket,
        undefined,
        error instanceof Error ? error.message : 'Falha ao retentar verificação.',
      );
    });
  });

  socket.on('EXPORT_SESSION', (payload) => {
    const parsed = EXPORT_SESSION_SCHEMA.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const pipeline = requireOwned(registry, socket, parsed.data.sessionId);
    if (pipeline === undefined) {
      return;
    }
    pipeline.exportSnapshot();
  });

  socket.on('DELETE_SESSION', (payload) => {
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
  });
}
