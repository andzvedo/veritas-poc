/* global Event, EventTarget, MediaDeviceInfo, MediaStream, MediaStreamConstraints, MediaTrackConstraints */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMicConstraints,
  DEFAULT_MIC_CAPTURE_MESSAGES,
  getMicSupportProblem,
  listMicrophones,
  mapUserMediaError,
  MIC_AUDIO_CONSTRAINTS,
  MicCaptureError,
  requestMicrophoneList,
  startMicCapture,
  type MediaDevicesLike,
} from '../micCapture';

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  stopCalls = 0;
  readonly label = 'MacBook Pro Microphone';
  stop(): void {
    this.stopCalls += 1;
    this.readyState = 'ended';
  }
  getSettings() {
    return { deviceId: 'mic-1' };
  }
  /** Simulates the device being unplugged. */
  unplug(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

function fakeStream(tracks: FakeTrack[]) {
  return {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function fakeDevices(
  overrides: Partial<MediaDevicesLike> & { track?: FakeTrack } = {},
) {
  const calls: MediaStreamConstraints[] = [];
  const track = overrides.track ?? new FakeTrack();
  const mediaDevices: MediaDevicesLike = {
    getUserMedia:
      overrides.getUserMedia ??
      (async (constraints) => {
        calls.push(constraints);
        return fakeStream([track]);
      }),
    enumerateDevices:
      overrides.enumerateDevices ??
      (async () =>
        [
          { kind: 'audioinput', deviceId: 'default', label: 'Default' },
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in' },
          { kind: 'audioinput', deviceId: 'mic-2', label: 'USB' },
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Cam' },
        ] as MediaDeviceInfo[]),
  };
  return { mediaDevices, calls, track };
}

test('constraints: speech-in-room settings, audio only, default device', () => {
  const constraints = buildMicConstraints();
  assert.equal(constraints.video, false);
  const audio = constraints.audio as MediaTrackConstraints;
  assert.equal(audio.echoCancellation, false);
  assert.equal(audio.noiseSuppression, true);
  assert.equal(audio.autoGainControl, true);
  assert.deepEqual(audio.sampleRate, { ideal: 16000 });
  assert.equal(audio.deviceId, undefined);
  assert.equal(
    (buildMicConstraints('default').audio as MediaTrackConstraints).deviceId,
    undefined,
  );
});

test('constraints: picked device uses exact deviceId', () => {
  const audio = buildMicConstraints('mic-2').audio as MediaTrackConstraints;
  assert.deepEqual(audio.deviceId, { exact: 'mic-2' });
  assert.equal(audio.noiseSuppression, MIC_AUDIO_CONSTRAINTS.noiseSuppression);
});

test('support: insecure context wins over missing API', () => {
  assert.equal(
    getMicSupportProblem({ isSecureContext: false, mediaDevices: {} }),
    'INSECURE_CONTEXT',
  );
  assert.equal(
    getMicSupportProblem({ isSecureContext: true, mediaDevices: {} }),
    'UNSUPPORTED',
  );
  assert.equal(
    getMicSupportProblem({
      isSecureContext: true,
      mediaDevices: fakeDevices().mediaDevices,
    }),
    null,
  );
});

test('start: insecure context rejects with INSECURE_CONTEXT and localized message', async () => {
  await assert.rejects(
    startMicCapture({
      isSecureContext: false,
      mediaDevices: fakeDevices().mediaDevices,
      messages: { INSECURE_CONTEXT: 'Use https' },
    }),
    (error: unknown) =>
      error instanceof MicCaptureError &&
      error.code === 'INSECURE_CONTEXT' &&
      error.message === 'Use https',
  );
});

test('start: success calls getUserMedia with the selected device', async () => {
  const { mediaDevices, calls } = fakeDevices();
  const capture = await startMicCapture({
    isSecureContext: true,
    mediaDevices,
    deviceId: 'mic-2',
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    (calls[0].audio as MediaTrackConstraints).deviceId,
    { exact: 'mic-2' },
  );
  assert.equal(capture.active, true);
  assert.equal(capture.deviceId, 'mic-1');
  assert.equal(capture.label, 'MacBook Pro Microphone');
});

test('start: maps getUserMedia rejections to stable codes', async () => {
  const cases: Array<[string, string]> = [
    ['NotAllowedError', 'PERMISSION_DENIED'],
    ['SecurityError', 'PERMISSION_DENIED'],
    ['NotFoundError', 'NO_DEVICE'],
    ['OverconstrainedError', 'NO_DEVICE'],
    ['NotReadableError', 'DEVICE_IN_USE'],
    ['TypeError', 'UNSUPPORTED'],
    ['WeirdError', 'CAPTURE_FAILED'],
  ];
  for (const [name, code] of cases) {
    const { mediaDevices } = fakeDevices({
      getUserMedia: async () => {
        throw domError(name);
      },
    });
    await assert.rejects(
      startMicCapture({ isSecureContext: true, mediaDevices }),
      (error: unknown) =>
        error instanceof MicCaptureError &&
        error.code === code &&
        error.message ===
          DEFAULT_MIC_CAPTURE_MESSAGES[code as MicCaptureError['code']],
      name,
    );
  }
});

test('mapUserMediaError: uses localized overrides', () => {
  const error = mapUserMediaError(domError('NotAllowedError'), {
    PERMISSION_DENIED: 'Microphone access was denied.',
  });
  assert.equal(error.code, 'PERMISSION_DENIED');
  assert.equal(error.message, 'Microphone access was denied.');
});

test('start: stream without live audio track is rejected and released', async () => {
  const track = new FakeTrack();
  track.readyState = 'ended';
  const { mediaDevices } = fakeDevices({ track });
  await assert.rejects(
    startMicCapture({ isSecureContext: true, mediaDevices }),
    (error: unknown) =>
      error instanceof MicCaptureError && error.code === 'NO_AUDIO_TRACK',
  );
  assert.equal(track.stopCalls, 1);
});

test('unplugged device: emits DEVICE_DISCONNECTED then ended once', async () => {
  const { mediaDevices, track } = fakeDevices();
  const capture = await startMicCapture({ isSecureContext: true, mediaDevices });
  const events: string[] = [];
  capture.onError((error) => events.push(`error:${error.code}`));
  capture.onEnded((info) => events.push(`ended:${info.reason}`));

  track.unplug();
  track.unplug();

  assert.deepEqual(events, [
    'error:DEVICE_DISCONNECTED',
    'ended:device-disconnected',
  ]);
  assert.equal(capture.active, false);
});

test('stop(): releases the mic, is idempotent and does not fire onEnded', async () => {
  const { mediaDevices, track } = fakeDevices();
  const capture = await startMicCapture({ isSecureContext: true, mediaDevices });
  let ended = 0;
  capture.onEnded(() => {
    ended += 1;
  });
  capture.stop();
  capture.stop();
  assert.equal(track.stopCalls, 1);
  assert.equal(capture.active, false);
  track.dispatchEvent(new Event('ended'));
  assert.equal(ended, 0);
});

test('listMicrophones: only real audio inputs, no virtual default', async () => {
  const list = await listMicrophones({ mediaDevices: fakeDevices().mediaDevices });
  assert.deepEqual(
    list.map((d) => d.deviceId),
    ['mic-1', 'mic-2'],
  );
  assert.deepEqual(await listMicrophones({ mediaDevices: {} }), []);
});

test('requestMicrophoneList: asks permission, releases mic, returns devices', async () => {
  const { mediaDevices, track, calls } = fakeDevices();
  const list = await requestMicrophoneList({
    isSecureContext: true,
    mediaDevices,
  });
  assert.equal(calls.length, 1);
  assert.equal(track.stopCalls, 1);
  assert.equal(list.length, 2);
});
