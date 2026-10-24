/**
 * Reproduction for the "100 lacunas de áudio / Aguardando a primeira fala…"
 * bug (microphone live mode, 2026-10-23).
 *
 * Drives the real Socket.IO server + live handlers with a client that behaves
 * like the browser AudioChunker: 100 ms pcm16 chunks (1600 samples), at most 8
 * chunks awaiting ACK and up to 3 immediate retries per rejected chunk. Time is
 * simulated (`now`) so 2 minutes of real-time cadence run in milliseconds.
 *
 * whisper.cpp is NOT installed here (nor on the reporter's Mac): scenario 1
 * uses the real provider factory with an empty env, exactly as `pnpm dev` does
 * without WHISPER_CPP_* / ALLOW_CLOUD_TRANSCRIPTION.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server } from 'socket.io';
import type {
  AudioChunkAckEvent,
  LiveGapEvent,
  LiveSessionStateEvent,
} from '@veritas/shared';
import { createWebSocketServer } from '#/ws/index.js';
import {
  attachLiveSessionHandlers,
  type LiveHandlersOptions,
} from '#/ws/liveHandlers.js';
import { LiveSessionRegistry } from '#/live/sessionRegistry.js';
import { UnknownSpeakerProvider } from '#/live/speakerIdentification.js';
import {
  TranscriptionUnavailableError,
  type TranscriptionOptions,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '#/live/transcription.js';

const CHUNK_SAMPLES = 1600; // 100 ms @ 16 kHz, same as the browser chunker.
const CHUNK_MS = 100;
const MAX_IN_FLIGHT = 8;
const MAX_RETRIES = 3;

class FakeTranscriber implements TranscriptionProvider {
  readonly name = 'fake';
  calls = 0;
  constructor(private readonly failWith?: Error) {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
  transcribe(
    _pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    this.calls += 1;
    if (this.failWith !== undefined) {
      return Promise.reject(this.failWith);
    }
    return Promise.resolve({
      text: `Fala número ${String(this.calls)} sobre a inflação.`,
      confidence: 0.9,
      segments: [
        {
          text: `Fala número ${String(this.calls)} sobre a inflação.`,
          startMs: 0,
          endMs: options.durationMs,
          confidence: 0.9,
        },
      ],
    });
  }
}

const speechPcm = (): Buffer => {
  const pcm = Buffer.alloc(CHUNK_SAMPLES * 2);
  for (let index = 0; index < CHUNK_SAMPLES; index++) {
    pcm.writeInt16LE(Math.round(Math.sin(index / 5) * 9_000), index * 2);
  }
  return pcm;
};

type Harness = {
  client: ClientSocket;
  clock: { now: number };
  states: LiveSessionStateEvent[];
  gaps: LiveGapEvent[];
  acks: AudioChunkAckEvent[];
  started: boolean;
};

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup(
  options: Omit<LiveHandlersOptions, 'registry' | 'now'>,
): Promise<Harness> {
  const clock = { now: 1_000_000 };
  const httpServer = createServer();
  const io: Server = createWebSocketServer(httpServer, (socket) => {
    attachLiveSessionHandlers(socket, {
      registry: new LiveSessionRegistry(),
      createDiarization: () => new UnknownSpeakerProvider(),
      now: () => clock.now,
      ...options,
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const { port } = httpServer.address() as AddressInfo;
  const client = ioClient(`http://127.0.0.1:${String(port)}`, {
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => { resolve(); });
    client.once('connect_error', reject);
  });
  const harness: Harness = {
    client,
    clock,
    states: [],
    gaps: [],
    acks: [],
    started: false,
  };
  client.on('LIVE_SESSION_STATE', (event: LiveSessionStateEvent) => {
    harness.states.push(event);
  });
  client.on('LIVE_GAP', (event: LiveGapEvent) => {
    harness.gaps.push(event);
  });
  client.on('AUDIO_CHUNK_ACK', (event: AudioChunkAckEvent) => {
    harness.acks.push(event);
  });
  client.on('LIVE_SESSION_STARTED', () => {
    harness.started = true;
  });
  cleanup = async () => {
    client.disconnect();
    await io.close();
  };
  return harness;
}

const until = async (
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

const start = (harness: Harness, sessionId: string): void => {
  harness.client.emit('START_LIVE_SESSION', {
    sessionId,
    source: 'MIC',
    language: 'pt-BR',
    consent: true,
  });
};

/**
 * Streams `seconds` of audio like the browser chunker. `retryRejected`
 * reproduces the pre-fix client, which retried every rejection 3× immediately.
 */
async function streamRealtime(
  harness: Harness,
  sessionId: string,
  seconds: number,
  retryRejected: boolean,
): Promise<{ sent: number; emitted: number; droppedLocally: number }> {
  const pcm = speechPcm();
  const inFlight = new Map<number, number>(); // chunkSeq -> attempts
  let droppedLocally = 0;
  let emitted = 0;
  const send = (chunkSeq: number): void => {
    emitted += 1;
    harness.client.emit(
      'AUDIO_CHUNK',
      {
        sessionId,
        chunkSeq,
        encoding: 'pcm16le',
        sampleRate: 16_000,
        channels: 1,
        samples: CHUNK_SAMPLES,
        startSample: chunkSeq * CHUNK_SAMPLES,
        capturedAt: new Date(harness.clock.now).toISOString(),
      },
      pcm,
    );
  };
  harness.client.on('AUDIO_CHUNK_ACK', (event: AudioChunkAckEvent) => {
    const { chunkSeq, accepted } = event.data;
    if (!inFlight.has(chunkSeq)) return;
    if (accepted) {
      inFlight.delete(chunkSeq);
      return;
    }
    const attempts = (inFlight.get(chunkSeq) ?? 0) + 1;
    if (retryRejected && attempts <= MAX_RETRIES) {
      inFlight.set(chunkSeq, attempts);
      send(chunkSeq);
      return;
    }
    inFlight.delete(chunkSeq);
  });

  const total = Math.round((seconds * 1000) / CHUNK_MS);
  for (let chunkSeq = 0; chunkSeq < total; chunkSeq++) {
    harness.clock.now += CHUNK_MS;
    if (inFlight.size >= MAX_IN_FLIGHT) {
      // Browser: `saturated` gap, audio skipped.
      droppedLocally += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      continue;
    }
    inFlight.set(chunkSeq, 0);
    send(chunkSeq);
    // Let the server answer roughly as fast as a LAN round trip would.
    await until(() => inFlight.size < MAX_IN_FLIGHT, 2_000).catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { sent: total, emitted, droppedLocally };
}

describe('live microphone streaming in real-time cadence (gap repro)', () => {
  it('fails START immediately with an actionable TRANSCRIPTION_UNAVAILABLE error when whisper.cpp is not configured', async () => {
    const harness = await setup({ env: {} });
    start(harness, 'mic-no-whisper');
    await until(() => harness.states.length > 0);

    const error = harness.states[0];
    expect(error.data.state).toBe('ERROR');
    expect(error.data.code).toBe('TRANSCRIPTION_UNAVAILABLE');
    expect(error.data.reason).toContain('WHISPER_CPP_MODEL');
    expect(error.data.reason).toContain('ALLOW_CLOUD_TRANSCRIPTION');
    // No session was created: the client must not start streaming audio.
    expect(harness.started).toBe(false);
  });

  it('streams 2 minutes of 100 ms chunks without a single gap when a transcriber is available', async () => {
    const transcriber = new FakeTranscriber();
    const harness = await setup({
      createTranscription: () => Promise.resolve(transcriber),
      pipelineOverrides: {
        extractClaimsFn: vi.fn(() => Promise.resolve([])) as never,
      },
    });
    const finals: unknown[] = [];
    harness.client.on('TRANSCRIPT_FINAL', (event: unknown) => {
      finals.push(event);
    });
    harness.client.on('TRANSCRIPT_PARTIAL', (event: unknown) => {
      finals.push(event);
    });
    start(harness, 'mic-ok');
    await until(() => harness.started);

    const result = await streamRealtime(harness, 'mic-ok', 120, true);

    expect(result.droppedLocally).toBe(0);
    expect(result.emitted).toBe(1_200);
    const accepted = harness.acks.filter((ack) => ack.data.accepted);
    expect(accepted).toHaveLength(1_200);
    expect(harness.gaps).toHaveLength(0);
    expect(
      harness.states.filter((state) => state.data.state === 'ERROR'),
    ).toHaveLength(0);
    expect(transcriber.calls).toBeGreaterThan(10);
    expect(finals.length).toBeGreaterThan(0);
  });

  it('a transcriber that disappears mid-session reports a coded ERROR and rejection reasons instead of retryable silence', async () => {
    const harness = await setup({
      createTranscription: () =>
        Promise.resolve(
          new FakeTranscriber(
            new TranscriptionUnavailableError(
              'whisper.cpp não pôde ser executado (ENOENT). Verifique WHISPER_CPP_BIN.',
            ),
          ),
        ),
      pipelineOverrides: {
        sessionConfig: { windowMs: 1_000, overlapMs: 0 },
      },
    });
    start(harness, 'mic-lost-whisper');
    await until(() => harness.started);

    // Pre-fix client behaviour: retry every rejection 3× immediately.
    const result = await streamRealtime(harness, 'mic-lost-whisper', 30, true);

    const error = harness.states.find((state) => state.data.state === 'ERROR');
    expect(error?.data.code).toBe('TRANSCRIPTION_UNAVAILABLE');
    expect(error?.data.reason).toContain('WHISPER_CPP_BIN');
    expect(
      harness.gaps.some((gap) => gap.data.reason === 'transcription_error'),
    ).toBe(true);

    const rejected = harness.acks.filter((ack) => !ack.data.accepted);
    expect(rejected.length).toBeGreaterThan(0);
    // The ACK now says *why*, so the client can stop instead of retrying.
    expect(
      rejected.every(
        (ack) =>
          ack.data.reason === 'not_listening' ||
          ack.data.reason === 'rate_limited',
      ),
    ).toBe(true);
    // Evidence of the old storm: 10 chunks/s × 4 sends exceeds the 32/s
    // audio budget. Before the fix those events were dropped with no ACK at
    // all, pinning the browser's 8-slot window → a `saturated` gap every
    // 100 ms. Now each one is rejected explicitly and nothing saturates.
    expect(rejected.some((ack) => ack.data.reason === 'rate_limited')).toBe(
      true,
    );
    expect(result.droppedLocally).toBe(0);
    expect(result.emitted).toBe(harness.acks.length);
    // The audio rate limit is not a session ERROR (the client used to treat
    // it as fatal).
    expect(
      harness.states.some((state) => state.data.code === 'RATE_LIMITED'),
    ).toBe(false);
  });

  it('the fixed client (no retry on a reasoned rejection) never trips the rate limit', async () => {
    const harness = await setup({
      createTranscription: () =>
        Promise.resolve(
          new FakeTranscriber(
            new TranscriptionUnavailableError('whisper.cpp indisponível.'),
          ),
        ),
      pipelineOverrides: {
        sessionConfig: { windowMs: 1_000, overlapMs: 0 },
      },
    });
    start(harness, 'mic-fixed-client');
    await until(() => harness.started);

    const result = await streamRealtime(harness, 'mic-fixed-client', 30, false);

    expect(result.droppedLocally).toBe(0);
    expect(result.emitted).toBe(300);
    expect(harness.acks).toHaveLength(300);
    expect(
      harness.acks.some((ack) => ack.data.reason === 'rate_limited'),
    ).toBe(false);
  });
});
