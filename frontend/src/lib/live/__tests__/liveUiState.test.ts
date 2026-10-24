import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureFeedbackFromErrorCode,
  deriveLiveControlAvailability,
  deriveLiveStatusView,
  isLiveSessionActive,
  isResearchSaturated,
  isTranscriptDelayed,
  liveServerErrorKey,
} from '../liveUiState';

test('deriveLiveControlAvailability: idle allows start only', () => {
  const availability = deriveLiveControlAvailability({
    captureFeedback: 'idle',
    liveSessionState: null,
  });
  assert.equal(availability.canStart, true);
  assert.equal(availability.canPause, false);
  assert.equal(availability.canResume, false);
  assert.equal(availability.canStop, false);
});

test('deriveLiveControlAvailability: capturing enables pause and stop', () => {
  const availability = deriveLiveControlAvailability({
    captureFeedback: 'capturing',
    liveSessionState: 'LISTENING',
  });
  assert.equal(availability.canStart, false);
  assert.equal(availability.canPause, true);
  assert.equal(availability.canResume, false);
  assert.equal(availability.canStop, true);
});

test('deriveLiveControlAvailability: paused enables resume and stop', () => {
  const availability = deriveLiveControlAvailability({
    captureFeedback: 'paused',
    liveSessionState: 'PAUSED',
  });
  assert.equal(availability.canStart, false);
  assert.equal(availability.canPause, false);
  assert.equal(availability.canResume, true);
  assert.equal(availability.canStop, true);
});

test('deriveLiveControlAvailability: permission error allows retry start', () => {
  const availability = deriveLiveControlAvailability({
    captureFeedback: 'permission_error',
    liveSessionState: 'ERROR',
  });
  assert.equal(availability.canStart, true);
  assert.equal(availability.canStop, false);
});

test('deriveLiveStatusView: separates capture active, delay and saturation', () => {
  const view = deriveLiveStatusView({
    captureFeedback: 'capturing',
    liveSessionState: 'LISTENING',
    liveMetrics: {
      sessionId: 's1',
      stage: 'research',
      latencyMs: 1200,
      queueDepth: 12,
      deferred: 2,
    },
    lastTranscriptAt: new Date(Date.now() - 20_000).toISOString(),
    nowMs: Date.now(),
    hasGaps: true,
  });

  assert.equal(view.tone, 'running');
  assert.equal(view.messageKey, 'listening');
  assert.ok(view.feedbackKeys.includes('capture_active'));
  assert.ok(view.feedbackKeys.includes('transcript_delayed'));
  assert.ok(view.feedbackKeys.includes('research_saturated'));
  assert.ok(view.feedbackKeys.includes('gap'));
});

test('deriveLiveStatusView: no_audio is a distinct warning', () => {
  const view = deriveLiveStatusView({
    captureFeedback: 'no_audio',
    liveSessionState: null,
    liveMetrics: null,
    lastTranscriptAt: null,
    nowMs: Date.now(),
  });
  assert.equal(view.tone, 'warning');
  assert.equal(view.messageKey, 'no_audio');
});

test('isTranscriptDelayed: false before first segment', () => {
  assert.equal(
    isTranscriptDelayed({
      captureFeedback: 'capturing',
      liveSessionState: 'LISTENING',
      lastTranscriptAt: null,
      nowMs: Date.now(),
    }),
    false,
  );
});

test('isResearchSaturated: queue depth and deferred', () => {
  assert.equal(isResearchSaturated(null), false);
  assert.equal(
    isResearchSaturated({
      stage: 'research',
      latencyMs: 10,
      queueDepth: 2,
      deferred: 0,
    }),
    false,
  );
  assert.equal(
    isResearchSaturated({
      stage: 'research',
      latencyMs: 10,
      queueDepth: 8,
      deferred: 0,
    }),
    true,
  );
});

test('captureFeedbackFromErrorCode maps stable codes', () => {
  assert.equal(captureFeedbackFromErrorCode('PERMISSION_DENIED'), 'permission_error');
  assert.equal(captureFeedbackFromErrorCode('NO_AUDIO_TRACK'), 'no_audio');
  assert.equal(captureFeedbackFromErrorCode('UNSUPPORTED'), 'unsupported');
  assert.equal(captureFeedbackFromErrorCode('WORKLET_LOAD_FAILED'), 'connection_error');
});

test('isLiveSessionActive covers capture and server states', () => {
  assert.equal(isLiveSessionActive(null, 'idle'), false);
  assert.equal(isLiveSessionActive('LISTENING', 'idle'), true);
  assert.equal(isLiveSessionActive(null, 'capturing'), true);
  assert.equal(isLiveSessionActive('ENDED', 'ended'), false);
});

test('deriveLiveStatusView: server ERROR wins over local "capturing"', () => {
  // Regression: the chip said "Escutando / Captura ativa" while the backend
  // rejected every chunk because no transcriber was configured.
  for (const captureFeedback of ['capturing', 'paused', 'ended', 'idle'] as const) {
    const view = deriveLiveStatusView({
      captureFeedback,
      liveSessionState: 'ERROR',
      liveMetrics: null,
      lastTranscriptAt: null,
      nowMs: 0,
      hasGaps: true,
    });
    assert.equal(view.tone, 'error', captureFeedback);
    assert.equal(view.messageKey, 'session_error', captureFeedback);
    assert.equal(view.feedbackKeys.includes('capture_active'), false);
  }
});

test('deriveLiveStatusView: local permission errors stay specific under ERROR', () => {
  const view = deriveLiveStatusView({
    captureFeedback: 'permission_error',
    liveSessionState: 'ERROR',
    liveMetrics: null,
    lastTranscriptAt: null,
    nowMs: 0,
  });
  assert.equal(view.messageKey, 'permission_error');
});

test('liveServerErrorKey: maps codes and falls back to UNKNOWN', () => {
  assert.equal(liveServerErrorKey('TRANSCRIPTION_UNAVAILABLE'), 'TRANSCRIPTION_UNAVAILABLE');
  assert.equal(liveServerErrorKey(null), 'UNKNOWN');
  assert.equal(liveServerErrorKey(undefined), 'UNKNOWN');
});
