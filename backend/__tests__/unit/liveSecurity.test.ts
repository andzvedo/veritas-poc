/**
 * LIVE-038 — security, privacy and retention of live sessions.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import {
  CORRECT_TRANSCRIPT_SCHEMA,
  LIVE_PAYLOAD_LIMITS,
  START_LIVE_SESSION_SCHEMA,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@veritas/shared';
import { LiveSessionRegistry } from '#/live/sessionRegistry.js';
import { LiveSessionUnavailableError } from '#/live/liveSession.js';
import { attachLiveSessionHandlers, toPcmBuffer } from '#/ws/liveHandlers.js';
import { MAX_SOCKET_MESSAGE_BYTES } from '#/ws/index.js';
import { TokenBucket } from '#/utils/rateLimit.js';
import { isSafeExternalUrl, redactSecretText } from '#/utils/security.js';
import { createTavilyProvider } from '#/research/tavily.js';
import { ResearchError } from '#/research/types.js';
import {
  ScriptedTranscription,
  createHarness,
  flush,
  scriptedDiarization,
} from '../helpers/livePipelineHarness.js';

const pipelineFor = (sessionId: string, ownerSocketId: string) =>
  createHarness({ lines: [], withLlms: false, sessionId, ownerSocketId });

describe('LiveSessionRegistry resume token and limits', () => {
  it('requires the resume token (and RECONNECTING) for another socket', () => {
    const registry = new LiveSessionRegistry();
    const h = pipelineFor('s-1', 'socket-a');
    const token = registry.register(h.pipeline);
    h.pipeline.start(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    expect(registry.reclaim('s-1', 'socket-a')).toBe(h.pipeline);
    // Right token but the owner is still connected: no takeover.
    expect(registry.reclaim('s-1', 'socket-b', token)).toBeUndefined();

    registry.markSocketDisconnected('socket-a');
    expect(registry.reclaim('s-1', 'socket-b')).toBeUndefined();
    expect(registry.reclaim('s-1', 'socket-b', 'x'.repeat(43))).toBeUndefined();
    expect(registry.reclaim('s-1', 'socket-b', token)).toBe(h.pipeline);
    expect(h.pipeline.ownerSocketId).toBe('socket-b');
  });

  it('sends the token only in LIVE_SESSION_STARTED, never in snapshots or exports', () => {
    const registry = new LiveSessionRegistry();
    const h = pipelineFor('s-2', 'socket-a');
    const token = registry.register(h.pipeline);
    h.pipeline.start(token);
    const started = h.of('LIVE_SESSION_STARTED')[0]['data'] as Record<string, unknown>;
    expect(started['resumeToken']).toBe(token);
    h.pipeline.resumeSession(0);
    h.pipeline.exportSession();
    const later = JSON.stringify([...h.of('SESSION_SNAPSHOT'), ...h.of('SESSION_EXPORT')]);
    expect(later).not.toContain(token);
  });

  it('a restarted instance (new registry) knows no sessions', () => {
    const before = new LiveSessionRegistry();
    const h = pipelineFor('s-3', 'socket-a');
    const token = before.register(h.pipeline);
    const restarted = new LiveSessionRegistry();
    expect(restarted.get('s-3')).toBeUndefined();
    expect(restarted.reclaim('s-3', 'socket-a', token)).toBeUndefined();
  });

  it('limits sessions per socket', () => {
    const registry = new LiveSessionRegistry({ maxSessionsPerSocket: 2 });
    registry.register(pipelineFor('p-1', 'socket-a').pipeline);
    registry.register(pipelineFor('p-2', 'socket-a').pipeline);
    expect(() => registry.register(pipelineFor('p-3', 'socket-a').pipeline)).toThrow(
      LiveSessionUnavailableError,
    );
    expect(() => registry.register(pipelineFor('p-4', 'socket-b').pipeline)).not.toThrow();
  });

  it('expires idle disconnected sessions and clears their credentials', () => {
    let now = 0;
    const registry = new LiveSessionRegistry({ idleTtlMs: 60_000, now: () => now });
    const h = createHarness({
      lines: [],
      withLlms: false,
      sessionId: 's-5',
      ownerSocketId: 'socket-a',
      apiKeys: { tavily: 'tvly-secret-222222222222222' },
    });
    registry.register(h.pipeline);
    h.pipeline.start();
    registry.markSocketDisconnected('socket-a');
    now = 61_000;
    expect(registry.get('s-5')).toBeUndefined();
    expect(h.pipeline.getStatus().hasCredentials).toBe(false);
    expect(h.pipeline.getRetentionPolicy()).toMatchObject({
      storage: 'MEMORY_ONLY',
      durableAfterRestart: false,
      idleTtlMs: 60_000,
    });
  });
});

type Emitted = { event: string; payload: Record<string, unknown> };
const fakeSocket = (id: string) => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emitted: Emitted[] = [];
  const socket = {
    id,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    },
    emit: (event: string, payload: Record<string, unknown>) => {
      emitted.push({ event, payload });
    },
  } as unknown as Socket<ClientToServerEvents, ServerToClientEvents>;
  const fire = (event: string, ...args: unknown[]) => handlers.get(event)?.(...args);
  const errors = () =>
    emitted.filter(
      (item) =>
        item.event === 'LIVE_SESSION_STATE' &&
        (item.payload['data'] as Record<string, unknown>)['state'] === 'ERROR',
    );
  return { socket, handlers, emitted, fire, errors };
};

const handlerOptions = (registry: LiveSessionRegistry) => ({
  registry,
  createTranscription: () =>
    Promise.resolve(new ScriptedTranscription(['fala'])),
  createDiarization: () => scriptedDiarization(['SPEAKER_00']),
  env: {},
});

describe('live socket handlers hardening', () => {
  it('never throws on null/garbage payloads for any client event', async () => {
    const registry = new LiveSessionRegistry();
    const client = fakeSocket('socket-a');
    attachLiveSessionHandlers(client.socket, handlerOptions(registry));
    for (const [event, handler] of client.handlers) {
      if (event === 'disconnect') continue;
      expect(() => {
        handler(null);
      }).not.toThrow();
      expect(() => {
        handler('x', 42);
      }).not.toThrow();
      expect(() => {
        handler({ sessionId: { $ne: 1 } });
      }).not.toThrow();
    }
    await flush();
  });

  it('rejects non-binary, odd-length and oversized audio', () => {
    expect(toPcmBuffer('AAAA')).toBeUndefined();
    expect(toPcmBuffer({ length: 2 })).toBeUndefined();
    expect(toPcmBuffer(Buffer.alloc(3))).toBeUndefined();
    expect(toPcmBuffer(Buffer.alloc(0))).toBeUndefined();
    expect(toPcmBuffer(Buffer.alloc(LIVE_PAYLOAD_LIMITS.maxChunkSamples * 2 + 2))).toBeUndefined();
    expect(toPcmBuffer(new Uint8Array(4))?.byteLength).toBe(4);
    expect(MAX_SOCKET_MESSAGE_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });

  it('rate-limits control events per socket with a single notice', () => {
    let now = 0;
    const registry = new LiveSessionRegistry();
    const client = fakeSocket('socket-a');
    attachLiveSessionHandlers(client.socket, {
      ...handlerOptions(registry),
      now: () => now,
      rateLimits: { control: { capacity: 2, refillPerSecond: 1 } },
    });
    for (let index = 0; index < 6; index++) {
      client.fire('PAUSE_LIVE_SESSION', { sessionId: 'nope' });
    }
    const limited = client
      .errors()
      .filter((item) =>
        String((item.payload['data'] as Record<string, unknown>)['reason']).includes('Limite'),
      );
    expect(limited).toHaveLength(1);
    now = 5_000;
    client.fire('PAUSE_LIVE_SESSION', { sessionId: 'nope' });
    expect(client.errors().filter((item) =>
      String((item.payload['data'] as Record<string, unknown>)['reason']).includes('Limite'),
    )).toHaveLength(1);
  });

  it('resumes from a new socket only with the token; human review stays owner-only', async () => {
    const registry = new LiveSessionRegistry();
    const a = fakeSocket('socket-a');
    attachLiveSessionHandlers(a.socket, handlerOptions(registry));
    a.fire('START_LIVE_SESSION', {
      sessionId: 'sess-tok',
      source: 'TAB',
      language: 'pt-BR',
      consent: true,
    });
    await flush();
    const started = a.emitted.find((item) => item.event === 'LIVE_SESSION_STARTED');
    const token = (started?.payload['data'] as Record<string, unknown>)['resumeToken'] as string;
    expect(typeof token).toBe('string');

    const b = fakeSocket('socket-b');
    attachLiveSessionHandlers(b.socket, handlerOptions(registry));
    b.fire('SUBMIT_HUMAN_REVIEW', {
      sessionId: 'sess-tok',
      verificationId: 'verification-x-0',
      expectedRevision: 0,
      decision: 'CONFIRMED',
    });
    expect(b.emitted.some((item) => item.event === 'HUMAN_REVIEW_RECORDED')).toBe(false);

    a.fire('disconnect');
    b.fire('RESUME_SESSION', { sessionId: 'sess-tok', cursor: 0 });
    expect(b.emitted.some((item) => item.event === 'SESSION_SNAPSHOT')).toBe(false);
    expect(b.errors().length).toBeGreaterThan(0);

    b.fire('RESUME_SESSION', { sessionId: 'sess-tok', cursor: 0, resumeToken: token });
    expect(b.emitted.some((item) => item.event === 'SESSION_SNAPSHOT')).toBe(true);
    expect(registry.get('sess-tok')?.ownerSocketId).toBe('socket-b');
    registry.get('sess-tok')?.cancel('test');
  });
});

describe('payload limits and URL policy', () => {
  it('bounds identifiers and text sizes in client schemas', () => {
    expect(
      START_LIVE_SESSION_SCHEMA.safeParse({ sessionId: 'a b', source: 'TAB', language: 'pt-BR' }).success,
    ).toBe(false);
    expect(
      CORRECT_TRANSCRIPT_SCHEMA.safeParse({
        sessionId: 's',
        segmentId: 'seg',
        text: 'x'.repeat(LIVE_PAYLOAD_LIMITS.maxCorrectionChars + 1),
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });

  it('only allows public http(s) URLs', () => {
    for (const url of [
      'https://www.ibge.gov.br/estatisticas',
      'http://example.org/a?b=1',
    ]) {
      expect(isSafeExternalUrl(url)).toBe(true);
    }
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://localhost:3001/',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://user:pass@example.org/',
      'http://printer.local/',
      'http://metadata.google.internal/',
      `https://example.org/${'a'.repeat(2100)}`,
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false);
    }
  });

  it('Tavily extract refuses private URLs without calling the network', async () => {
    const fetchImpl = vi.fn();
    const provider = createTavilyProvider({
      apiKey: 'tvly-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.extract('http://169.254.169.254/latest')).rejects.toBeInstanceOf(
      ResearchError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('redacts secrets in long texts without truncating them', () => {
    const long = `${'palavra '.repeat(100)}AIzaSyD0000000000000000000000000000000 fim`;
    const redacted = redactSecretText(long);
    expect(redacted).not.toContain('AIzaSyD0000000000');
    expect(redacted.endsWith('fim')).toBe(true);
    expect(redacted.length).toBeGreaterThan(700);
  });

  it('token bucket refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1, now: () => now });
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    now = 1_000;
    expect(bucket.tryTake()).toBe(true);
  });
});
