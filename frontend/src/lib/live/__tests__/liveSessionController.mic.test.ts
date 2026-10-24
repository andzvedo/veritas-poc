/* global Event, EventTarget, MediaStream, queueMicrotask */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioChunker } from '@/lib/audio/audioStream';
import { startMicCapture, type MediaDevicesLike } from '@/lib/audio/micCapture';
import {
  LiveSessionController,
  LiveSessionStartError,
  classifyChunkAck,
} from '@/lib/live/liveSessionController';
import { deriveLiveStatusView } from '@/lib/live/liveUiState';
import type { AudioChunkAckListener } from '@/lib/services/factCheckService';
import { factCheckService } from '@/lib/services/factCheckService';
import { useFactCheckStore } from '@/lib/store/factCheckStore';

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  readonly label = 'Mic';
  stop(): void {
    this.readyState = 'ended';
  }
  getSettings() {
    return { deviceId: 'mic-1' };
  }
}

type ServerReply =
  | { kind: 'started' }
  | { kind: 'error'; reason: string; code: 'TRANSCRIPTION_UNAVAILABLE' }
  | { kind: 'silent' };

/**
 * Stubs the socket service. `reply` simulates what the backend answers to
 * START_LIVE_SESSION (LIVE_SESSION_STARTED, a coded ERROR, or nothing).
 */
function installServiceStubs(reply: ServerReply = { kind: 'started' }) {
  const calls: Array<[string, unknown]> = [];
  const ackListeners: AudioChunkAckListener[] = [];
  const service = factCheckService as unknown as Record<string, unknown>;
  service.ensureConnected = async () => {};
  service.onAudioChunkAck = (listener: AudioChunkAckListener) => {
    ackListeners.push(listener);
    return () => {
      ackListeners.splice(ackListeners.indexOf(listener), 1);
    };
  };
  for (const name of [
    'startLiveSession',
    'endLiveSession',
    'cancelLiveSession',
    'pauseLiveSession',
    'resumeLiveSession',
    'sendAudioChunk',
  ]) {
    service[name] = (payload: unknown) => {
      calls.push([name, payload]);
      if (name !== 'startLiveSession') return;
      queueMicrotask(() => {
        const store = useFactCheckStore.getState();
        if (reply.kind === 'started') store.setLiveSessionState('LISTENING');
        if (reply.kind === 'error') {
          store.setLiveSessionState('ERROR', {
            reason: reply.reason,
            code: reply.code,
          });
        }
      });
    };
  }
  return { calls, ackListeners };
}

function fakeChunker() {
  const state = {
    started: 0,
    stopped: 0,
    acked: [] as number[],
    failed: [] as number[],
    dropped: [] as Array<[number, string]>,
  };
  const chunker = {
    capturedAt: null,
    start: async () => {
      state.started += 1;
    },
    stop: async () => {
      state.stopped += 1;
    },
    pause: () => {},
    resume: async () => {},
    ack: (seq: number) => {
      state.acked.push(seq);
      return true;
    },
    fail: (seq: number) => {
      state.failed.push(seq);
      return {};
    },
    drop: (seq: number, reason: string) => {
      state.dropped.push([seq, reason]);
      return {};
    },
  } as unknown as AudioChunker;
  return { chunker, state };
}

function micDevices(track: FakeTrack): MediaDevicesLike {
  return {
    getUserMedia: async () =>
      ({
        getAudioTracks: () => [track],
        getTracks: () => [track],
      }) as unknown as MediaStream,
  };
}

test('controller: starts the session with source MIC from the microphone', async () => {
  const { calls } = installServiceStubs();
  const track = new FakeTrack();
  const { chunker, state } = fakeChunker();
  const controller = new LiveSessionController();

  await controller.start({
    createSessionId: () => 'session-mic',
    startCapture: () =>
      startMicCapture({ isSecureContext: true, mediaDevices: micDevices(track) }),
    createChunker: () => chunker,
  });

  const start = calls.find(([name]) => name === 'startLiveSession');
  assert.ok(start);
  assert.equal((start[1] as { source: string }).source, 'MIC');
  assert.equal(state.started, 1);
  assert.equal(useFactCheckStore.getState().captureFeedback, 'capturing');
  await controller.stop();
});

test('controller: unplugged mic shows localized error and ends the session', async () => {
  const { calls } = installServiceStubs();
  const track = new FakeTrack();
  const { chunker, state } = fakeChunker();
  const controller = new LiveSessionController();

  await controller.start({
    createSessionId: () => 'session-unplug',
    startCapture: () =>
      startMicCapture({
        isSecureContext: true,
        mediaDevices: micDevices(track),
        messages: { DEVICE_DISCONNECTED: 'Mic unplugged' },
      }),
    createChunker: () => chunker,
  });

  track.readyState = 'ended';
  track.dispatchEvent(new Event('ended'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(useFactCheckStore.getState().error, 'Mic unplugged');
  assert.equal(useFactCheckStore.getState().captureFeedback, 'no_audio');
  assert.ok(calls.some(([name]) => name === 'endLiveSession'));
  assert.equal(state.stopped, 1);
  assert.equal(controller.getPhase(), 'stopped');
});

test('controller: permission denied surfaces permission_error, no session', async () => {
  const { calls } = installServiceStubs();
  const controller = new LiveSessionController();
  const denied = new Error('denied');
  denied.name = 'NotAllowedError';

  await assert.rejects(
    controller.start({
      startCapture: () =>
        startMicCapture({
          isSecureContext: true,
          mediaDevices: {
            getUserMedia: async () => {
              throw denied;
            },
          },
        }),
    }),
  );

  assert.equal(useFactCheckStore.getState().captureFeedback, 'permission_error');
  assert.equal(calls.some(([name]) => name === 'startLiveSession'), false);
  assert.equal(controller.getPhase(), 'error');
});

const micStart = (track: FakeTrack) => () =>
  startMicCapture({ isSecureContext: true, mediaDevices: micDevices(track) });

test('controller: waits for the server before streaming audio', async () => {
  const { calls } = installServiceStubs({ kind: 'silent' });
  const track = new FakeTrack();
  const { chunker, state } = fakeChunker();
  const controller = new LiveSessionController();

  const pending = controller.start({
    createSessionId: () => 'session-wait',
    startCapture: micStart(track),
    createChunker: () => chunker,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.ok(calls.some(([name]) => name === 'startLiveSession'));
  // No audio before LIVE_SESSION_STARTED (it would be SESSION_NOT_FOUND).
  assert.equal(state.started, 0);
  useFactCheckStore.getState().setLiveSessionState('LISTENING');
  await pending;
  assert.equal(state.started, 1);
  assert.equal(useFactCheckStore.getState().captureFeedback, 'capturing');
  await controller.stop();
});

test('controller: TRANSCRIPTION_UNAVAILABLE at start releases the mic and never streams', async () => {
  installServiceStubs({
    kind: 'error',
    reason: 'Transcrição indisponível: defina WHISPER_CPP_MODEL.',
    code: 'TRANSCRIPTION_UNAVAILABLE',
  });
  const track = new FakeTrack();
  const { chunker, state } = fakeChunker();
  const controller = new LiveSessionController();

  await assert.rejects(
    controller.start({
      createSessionId: () => 'session-no-whisper',
      startCapture: micStart(track),
      createChunker: () => chunker,
    }),
    (error: unknown) =>
      error instanceof LiveSessionStartError &&
      error.code === 'TRANSCRIPTION_UNAVAILABLE',
  );

  assert.equal(state.started, 0);
  assert.equal(track.readyState, 'ended');
  assert.equal(controller.getPhase(), 'error');
  const store = useFactCheckStore.getState();
  assert.equal(store.liveSessionState, 'ERROR');
  assert.equal(store.liveErrorCode, 'TRANSCRIPTION_UNAVAILABLE');
  assert.match(store.error ?? '', /WHISPER_CPP_MODEL/);
  const view = deriveLiveStatusView({
    captureFeedback: store.captureFeedback,
    liveSessionState: store.liveSessionState,
    liveMetrics: null,
    lastTranscriptAt: null,
    nowMs: Date.now(),
  });
  assert.equal(view.messageKey, 'session_error');
});

test('controller: no server confirmation → coded START_FAILED, mic released', async () => {
  installServiceStubs({ kind: 'silent' });
  const track = new FakeTrack();
  const { chunker, state } = fakeChunker();
  const controller = new LiveSessionController();

  await assert.rejects(
    controller.start({
      createSessionId: () => 'session-timeout',
      startCapture: micStart(track),
      createChunker: () => chunker,
      startTimeoutMs: 10,
    }),
    (error: unknown) =>
      error instanceof LiveSessionStartError && error.code === 'START_FAILED',
  );
  assert.equal(state.started, 0);
  assert.equal(track.readyState, 'ended');
  assert.equal(useFactCheckStore.getState().liveErrorCode, 'START_FAILED');
});

test('controller: server ERROR mid-session stops capture instead of producing gaps', async () => {
  installServiceStubs();
  const track = new FakeTrack();
  const { chunker, state } = fakeChunker();
  const controller = new LiveSessionController();
  await controller.start({
    createSessionId: () => 'session-mid-error',
    startCapture: micStart(track),
    createChunker: () => chunker,
  });

  useFactCheckStore.getState().setLiveSessionState('ERROR', {
    reason: 'whisper.cpp falhou',
    code: 'TRANSCRIPTION_UNAVAILABLE',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.stopped, 1);
  assert.equal(track.readyState, 'ended');
  assert.equal(controller.getPhase(), 'error');
  const store = useFactCheckStore.getState();
  assert.equal(store.captureFeedback, 'ended');
  assert.equal(store.liveSessionState, 'ERROR');
});

test('controller: a reasoned rejection drops the chunk (no retry storm)', async () => {
  const { ackListeners } = installServiceStubs();
  const track = new FakeTrack();
  const { chunker, state } = fakeChunker();
  const controller = new LiveSessionController();
  await controller.start({
    createSessionId: () => 'session-acks',
    startCapture: micStart(track),
    createChunker: () => chunker,
  });

  const ack = ackListeners[0];
  assert.ok(ack);
  ack(1, true);
  ack(2, false, 'not_listening');
  ack(3, false, 'rate_limited');
  ack(4, false, 'duplicate');
  ack(5, false);

  assert.deepEqual(state.acked, [1, 4]);
  assert.deepEqual(state.dropped, [
    [2, 'not_listening'],
    [3, 'rate_limited'],
  ]);
  assert.deepEqual(state.failed, [5]);
  await controller.stop();
});

test('classifyChunkAck: retry only when the server gave no reason', () => {
  assert.equal(classifyChunkAck(true), 'ack');
  assert.equal(classifyChunkAck(false, 'duplicate'), 'ack');
  assert.equal(classifyChunkAck(false, 'overlap'), 'ack');
  assert.equal(classifyChunkAck(false), 'retry');
  for (const reason of [
    'not_listening',
    'ended',
    'paused',
    'rate_limited',
    'invalid',
    'buffer_limit',
    'pending_limit',
    'duration_limit',
  ] as const) {
    assert.equal(classifyChunkAck(false, reason), 'drop', reason);
  }
});
