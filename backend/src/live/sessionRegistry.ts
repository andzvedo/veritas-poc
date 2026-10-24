/**
 * In-memory live session registry (LIVE-006).
 *
 * Sessions are isolated by owner socket id. There is no durable restart:
 * {@link LiveSession.restoreFromPersistedState} remains the authoritative
 * rejection for cross-process resume. Abandoned RECONNECTING sessions expire.
 */
import { LivePipeline } from './livePipeline.js';
import { LiveSessionUnavailableError } from './liveSession.js';

export const DEFAULT_LIVE_SESSION_IDLE_MS = 15 * 60 * 1000;
export const DEFAULT_LIVE_MAX_SESSIONS = 32;

export type LiveSessionRegistryOptions = {
  maxSessions?: number;
  idleTtlMs?: number;
  now?: () => number;
};

type RegistryEntry = {
  pipeline: LivePipeline;
  lastTouchedAt: number;
};

export class LiveSessionRegistry {
  private readonly sessions = new Map<string, RegistryEntry>();
  private readonly maxSessions: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(options: LiveSessionRegistryOptions = {}) {
    this.maxSessions = Math.max(
      1,
      options.maxSessions ?? DEFAULT_LIVE_MAX_SESSIONS,
    );
    this.idleTtlMs = Math.max(
      1_000,
      options.idleTtlMs ?? DEFAULT_LIVE_SESSION_IDLE_MS,
    );
    this.now = options.now ?? (() => Date.now());
  }

  /** Authoritative rejection for restart-without-storage (P0). */
  static rejectDurableRestore(): never {
    throw new LiveSessionUnavailableError(
      'Sessão ao vivo não pode ser restaurada: não há persistência durável (P0). Inicie uma nova sessão.',
    );
  }

  get(sessionId: string): LivePipeline | undefined {
    this.evictExpired();
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return undefined;
    }
    entry.lastTouchedAt = this.now();
    return entry.pipeline;
  }

  /**
   * Returns the pipeline only when the caller owns it. Prevents cross-socket
   * control of another capture.
   */
  getOwned(sessionId: string, socketId: string): LivePipeline | undefined {
    const pipeline = this.get(sessionId);
    if (pipeline === undefined) {
      return undefined;
    }
    if (pipeline.ownerSocketId !== socketId) {
      return undefined;
    }
    return pipeline;
  }

  register(pipeline: LivePipeline): void {
    this.evictExpired();
    if (this.sessions.has(pipeline.sessionId)) {
      throw new LiveSessionUnavailableError(
        `Já existe uma sessão ao vivo com id "${pipeline.sessionId}" nesta instância.`,
      );
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new LiveSessionUnavailableError(
        `Limite de sessões ao vivo atingido (${String(this.maxSessions)}). Encerre uma sessão antes de iniciar outra.`,
      );
    }
    this.sessions.set(pipeline.sessionId, {
      pipeline,
      lastTouchedAt: this.now(),
    });
  }

  remove(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return;
    }
    entry.pipeline.clearCredentials();
    this.sessions.delete(sessionId);
  }

  /** Marks every session owned by `socketId` as reconnecting (transport lost). */
  markSocketDisconnected(socketId: string): void {
    for (const entry of this.sessions.values()) {
      if (entry.pipeline.ownerSocketId === socketId) {
        entry.pipeline.markReconnecting('transport_lost');
        entry.lastTouchedAt = this.now();
      }
    }
  }

  /**
   * Same-instance resume: allow reclaim while RECONNECTING (or still owned),
   * then rebind the controlling socket id.
   */
  reclaim(
    sessionId: string,
    newOwnerSocketId: string,
  ): LivePipeline | undefined {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return undefined;
    }
    const state = entry.pipeline.getStatus().captureState;
    const owned = entry.pipeline.ownerSocketId === newOwnerSocketId;
    if (!owned && state !== 'RECONNECTING') {
      return undefined;
    }
    entry.pipeline.ownerSocketId = newOwnerSocketId;
    entry.lastTouchedAt = this.now();
    return entry.pipeline;
  }

  size(): number {
    this.evictExpired();
    return this.sessions.size;
  }

  /** Locates a verification among sessions owned by `socketId`. */
  findOwnedByVerification(
    socketId: string,
    verificationId: string,
  ): LivePipeline | undefined {
    this.evictExpired();
    for (const entry of this.sessions.values()) {
      if (
        entry.pipeline.ownerSocketId === socketId &&
        entry.pipeline.hasVerification(verificationId)
      ) {
        entry.lastTouchedAt = this.now();
        return entry.pipeline;
      }
    }
    return undefined;
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.idleTtlMs;
    for (const [sessionId, entry] of [...this.sessions.entries()]) {
      const state = entry.pipeline.getStatus().captureState;
      const idle =
        entry.lastTouchedAt < cutoff &&
        (state === 'RECONNECTING' ||
          state === 'ENDED' ||
          state === 'PAUSED' ||
          state === 'ERROR');
      if (!idle) {
        continue;
      }
      if (state !== 'ENDED') {
        entry.pipeline.cancel('session_expired');
      }
      entry.pipeline.clearCredentials();
      this.sessions.delete(sessionId);
    }
  }
}

/** Process-wide registry used by Socket.IO handlers. */
export const liveSessionRegistry = new LiveSessionRegistry();
