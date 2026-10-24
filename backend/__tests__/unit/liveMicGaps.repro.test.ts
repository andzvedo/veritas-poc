/**
 * Reproduction + regression for live mic gaps (fix/live-mic-gaps):
 * - START must fail clearly when transcription is unavailable (no silent LISTENING).
 * - AUDIO_CHUNK before the session is registered must NACK (accepted:false),
 *   not drop silently (which saturates client flow-control into local gaps).
 */
import { describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';
import { attachLiveSessionHandlers } from '#/ws/liveHandlers.js';
import {
  UnavailableTranscriptionProvider,
  DEFAULT_UNAVAILABLE_TRANSCRIPTION_MESSAGE,
} from '#/live/transcription.js';
import { LiveSessionRegistry } from '#/live/sessionRegistry.js';
import {
  ScriptedTranscription,
  scriptedDiarization,
} from '../helpers/livePipelineHarness.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@veritas/shared';

type Emitted = { event: string; payload: Record<string, unknown> };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  const fire = (event: string, ...args: unknown[]) =>
    handlers.get(event)?.(...args);
  return { socket, emitted, fire };
};

const pcmChunk = (samples = 1600): Buffer => Buffer.alloc(samples * 2);

describe('live mic gaps reproduction', () => {
  it('rejects START when transcription is unavailable with an actionable ERROR', async () => {
    const registry = new LiveSessionRegistry();
    const client = fakeSocket('socket-no-asr');
    attachLiveSessionHandlers(client.socket, {
      registry,
      createTranscription: () =>
        Promise.resolve(new UnavailableTranscriptionProvider()),
      createDiarization: () => scriptedDiarization(['SPEAKER_00']),
      env: {},
    });

    client.fire('START_LIVE_SESSION', {
      sessionId: 'sess-no-asr',
      source: 'MIC',
      language: 'pt-BR',
      consent: true,
    });
    await flush();

    expect(
      client.emitted.some((item) => item.event === 'LIVE_SESSION_STARTED'),
    ).toBe(false);
    expect(registry.get('sess-no-asr')).toBeUndefined();

    const error = client.emitted.find(
      (item) =>
        item.event === 'LIVE_SESSION_STATE' &&
        (item.payload['data'] as { state?: string }).state === 'ERROR',
    );
    expect(error).toBeDefined();
    const reason = String(
      (error?.payload['data'] as { reason?: string }).reason ?? '',
    );
    expect(reason).toContain('Transcrição indisponível');
    expect(reason).toContain('WHISPER_CPP');
    expect(reason.length).toBeGreaterThan(
      Math.min(40, DEFAULT_UNAVAILABLE_TRANSCRIPTION_MESSAGE.length / 4),
    );
  });

  it('NACKs AUDIO_CHUNK before the session exists (no silent drop, no ERROR)', () => {
    const registry = new LiveSessionRegistry();
    const client = fakeSocket('socket-early');
    attachLiveSessionHandlers(client.socket, {
      registry,
      createTranscription: () =>
        Promise.resolve(new ScriptedTranscription(['fala'])),
      createDiarization: () => scriptedDiarization(['SPEAKER_00']),
      env: {},
    });

    const meta = {
      sessionId: 'sess-early',
      chunkSeq: 0,
      encoding: 'pcm16le' as const,
      sampleRate: 16000 as const,
      channels: 1 as const,
      samples: 1600,
      startSample: 0,
      capturedAt: new Date().toISOString(),
    };
    client.fire('AUDIO_CHUNK', meta, pcmChunk());

    const nacks = client.emitted.filter(
      (item) => item.event === 'AUDIO_CHUNK_ACK',
    );
    expect(nacks).toHaveLength(1);
    expect(nacks[0].payload['data']).toMatchObject({
      sessionId: 'sess-early',
      chunkSeq: 0,
      accepted: false,
    });
    expect(
      client.emitted.some(
        (item) =>
          item.event === 'LIVE_SESSION_STATE' &&
          (item.payload['data'] as { state?: string }).state === 'ERROR',
      ),
    ).toBe(false);
  });

  it('accepts chunks only after START completes with an available transcriber', async () => {
    const registry = new LiveSessionRegistry();
    const client = fakeSocket('socket-ok');
    attachLiveSessionHandlers(client.socket, {
      registry,
      createTranscription: () =>
        Promise.resolve(new ScriptedTranscription(['fala'])),
      createDiarization: () => scriptedDiarization(['SPEAKER_00']),
      env: {},
    });

    client.fire('START_LIVE_SESSION', {
      sessionId: 'sess-ok',
      source: 'MIC',
      language: 'pt-BR',
      consent: true,
    });
    await flush();

    expect(
      client.emitted.some((item) => item.event === 'LIVE_SESSION_STARTED'),
    ).toBe(true);

    client.fire(
      'AUDIO_CHUNK',
      {
        sessionId: 'sess-ok',
        chunkSeq: 0,
        encoding: 'pcm16le',
        sampleRate: 16000,
        channels: 1,
        samples: 1600,
        startSample: 0,
        capturedAt: new Date().toISOString(),
      },
      pcmChunk(),
    );

    const ack = client.emitted
      .filter((item) => item.event === 'AUDIO_CHUNK_ACK')
      .at(-1);
    expect(ack?.payload['data']).toMatchObject({
      sessionId: 'sess-ok',
      chunkSeq: 0,
      accepted: true,
    });

    registry.get('sess-ok')?.cancel('test');
  });
});
