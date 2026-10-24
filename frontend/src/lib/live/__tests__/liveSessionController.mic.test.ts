/* global Event, EventTarget, MediaStream */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioChunker } from '@/lib/audio/audioStream';
import { startMicCapture, type MediaDevicesLike } from '@/lib/audio/micCapture';
import { LiveSessionController } from '@/lib/live/liveSessionController';
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

function installServiceStubs() {
  const calls: Array<[string, unknown]> = [];
  const service = factCheckService as unknown as Record<string, unknown>;
  service.ensureConnected = async () => {};
  service.onAudioChunkAck = () => () => {};
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
    };
  }
  return calls;
}

function fakeChunker() {
  const state = { started: 0, stopped: 0 };
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
    ack: () => true,
    fail: () => ({}),
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
  const calls = installServiceStubs();
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
  const calls = installServiceStubs();
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
  const calls = installServiceStubs();
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
