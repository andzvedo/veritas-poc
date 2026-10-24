/**
 * In-memory live session registry (LIVE-006).
 *
 * Sessions are isolated by owner socket id. There is no durable restart:
 * {@link LiveSession.restoreFromPersistedState} remains the authoritative
 * rejection for cross-process resume. Abandoned RECONNECTING sessions expire.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { LivePipeline } from './livePipeline.js';
import { LiveSessionUnavailableError } from './liveSession.js';

import {
  DEFAULT_LIVE_MAX_SESSIONS,
  DEFAULT_LIVE_MAX_SESSIONS_PER_SOCKET,
  DEFAULT_LIVE_SESSION_IDLE_MS,
} from './retention.js';

export {
  DEFAULT_LIVE_MAX_SESSIONS,
  DEFAULT_LIVE_MAX_SESSIONS_PER_SOCKET,
  DEFAULT_LIVE_SESSION_IDLE_MS,
};

export type LiveSessionRegistryOptions = {
  maxSessions?: number;
  /** Sessions one socket may own at once (resource limit, LIVE-038). */
  maxSessionsPerSocket?: number;
  idleTtlMs?: number;
  now?: () => number;
};

type RegistryEntry = {
  pipeline: LivePipeline;
  lastTouchedAt: number;
  /** SHA-256 of the resume token; the token itself is never stored. */
  resumeTokenHash: Buffer;
};

const hashToken = (token: string): Buffer =>
  createHash('sha256').update(token, 'utf8').digest();

/** Constant-time comparison of a presented token against the stored hash. */
const tokenMatches = (presented: string | undefined, hash: Buffer): boolean => {
  if (presented === undefined || presented.length === 0) {
    return false;
  }
  return timingSafeEqual(hashToken(presented), hash);
};

export class LiveSessionRegistry {
  private readonly sessions = new Map<string, RegistryEntry>();
  private readonly maxSessions: number;
  private readonly maxSessionsPerSocket: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(options: LiveSessionRegistryOptions = {}) {
    this.maxSessions = Math.max(
      1,
      options.maxSessions ?? DEFAULT_LIVE_MAX_SESSIONS,
    );
    this.maxSessionsPerSocket = Math.max(
      1,
      options.maxSessionsPerSocket ?? DEFAULT_LIVE_MAX_SESSIONS_PER_SOCKET,
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

  /**
   * Registers a pipeline and returns its resume token: a 256-bit random
   * capability the owner must present to reclaim the session from another
   * socket. Only its hash is kept; it never appears in snapshots or logs.
   */
  register(pipeline: LivePipeline): string {
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
    const owned = [...this.sessions.values()].filter(
      (entry) => entry.pipeline.ownerSocketId === pipeline.ownerSocketId,
    ).length;
    if (owned >= this.maxSessionsPerSocket) {
      throw new LiveSessionUnavailableError(
        `Limite de sessões ao vivo por conexão atingido (${String(this.maxSessionsPerSocket)}).`,
      );
    }
    const resumeToken = randomBytes(32).toString('base64url');
    pipeline.setIdleTtlMs(this.idleTtlMs);
    this.sessions.set(pipeline.sessionId, {
      pipeline,
      lastTouchedAt: this.now(),
      resumeTokenHash: hashToken(resumeToken),
    });
    return resumeToken;
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
   * Same-instance resume. The current owner may always resume its own
   * session. Another socket may reclaim it only while RECONNECTING **and**
   * when it presents the session's resume token — knowing the sessionId is
   * not authorization (LIVE-038).
   */
  reclaim(
    sessionId: string,
    newOwnerSocketId: string,
    resumeToken?: string,
  ): LivePipeline | undefined {
    this.evictExpired();
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return undefined;
    }
    const owned = entry.pipeline.ownerSocketId === newOwnerSocketId;
    if (!owned) {
      // Token first: a caller without the credential learns nothing else.
      if (!tokenMatches(resumeToken, entry.resumeTokenHash)) {
        return undefined;
      }
      if (entry.pipeline.getStatus().captureState !== 'RECONNECTING') {
        return undefined;
      }
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
