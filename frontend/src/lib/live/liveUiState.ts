import type {
  LiveCaptureFeedback,
  LiveMetricsData,
  LiveSessionState,
  TranscriptSegment,
} from '@veritas/shared';

/**
 * Pure UI state helpers for Live mode controls and status (LIVE-007 / LIVE-025).
 * Kept free of React / DOM so unit tests can cover every transition.
 */

export type LiveInputMode = 'text' | 'live';

export type LiveControlAction = 'start' | 'pause' | 'resume' | 'stop';

export interface LiveControlAvailability {
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
}

export type LiveStatusTone = 'idle' | 'running' | 'paused' | 'warning' | 'error' | 'ended';

export interface LiveStatusView {
  tone: LiveStatusTone;
  /** Stable key for i18n lookup (e.g. `listening`, `no_audio`). */
  messageKey: string;
  /** Extra feedback chips shown alongside the primary status. */
  feedbackKeys: string[];
}

export interface DeriveLiveStatusInput {
  captureFeedback: LiveCaptureFeedback;
  liveSessionState: LiveSessionState | null;
  liveMetrics: LiveMetricsData | null;
  lastTranscriptAt: string | null;
  nowMs: number;
  /** When listening and no transcript arrives within this window, flag delay. */
  transcriptDelayMs?: number;
  segments?: readonly TranscriptSegment[];
  hasGaps?: boolean;
}

const ACTIVE_SERVER_STATES: ReadonlySet<LiveSessionState> = new Set([
  'CONNECTING',
  'LISTENING',
  'PAUSED',
  'RECONNECTING',
  'ENDING',
]);

export function isLiveSessionActive(
  liveSessionState: LiveSessionState | null,
  captureFeedback: LiveCaptureFeedback,
): boolean {
  if (
    captureFeedback === 'capturing' ||
    captureFeedback === 'paused' ||
    captureFeedback === 'requesting_permission' ||
    captureFeedback === 'ending'
  ) {
    return true;
  }
  return liveSessionState !== null && ACTIVE_SERVER_STATES.has(liveSessionState);
}

export function deriveLiveControlAvailability(input: {
  captureFeedback: LiveCaptureFeedback;
  liveSessionState: LiveSessionState | null;
}): LiveControlAvailability {
  const { captureFeedback, liveSessionState } = input;
  const capturing = captureFeedback === 'capturing';
  const paused = captureFeedback === 'paused' || liveSessionState === 'PAUSED';
  const endingFeedback = captureFeedback === 'ending';
  const endedFeedback = captureFeedback === 'ended';
  const sessionEnding = liveSessionState === 'ENDING';
  const sessionEnded = liveSessionState === 'ENDED';
  const busyPermission = captureFeedback === 'requesting_permission';
  const errorLike =
    captureFeedback === 'permission_error' ||
    captureFeedback === 'unsupported' ||
    captureFeedback === 'connection_error' ||
    captureFeedback === 'no_audio' ||
    liveSessionState === 'ERROR';

  const sessionLive =
    liveSessionState === 'LISTENING' ||
    liveSessionState === 'CONNECTING' ||
    liveSessionState === 'RECONNECTING';

  const inactiveForStart =
    captureFeedback === 'idle' ||
    endedFeedback ||
    errorLike ||
    liveSessionState === null ||
    liveSessionState === 'IDLE' ||
    sessionEnded;

  return {
    canStart:
      !busyPermission &&
      !capturing &&
      !paused &&
      !endingFeedback &&
      !sessionEnding &&
      inactiveForStart,
    canPause:
      (capturing || sessionLive) &&
      !paused &&
      !endingFeedback &&
      !sessionEnding &&
      !sessionEnded &&
      !busyPermission,
    canResume:
      paused && !endingFeedback && !sessionEnding && !sessionEnded && !busyPermission,
    canStop:
      (capturing || paused || sessionLive || sessionEnding || busyPermission) &&
      !endedFeedback &&
      !sessionEnded,
  };
}

export function isResearchSaturated(metrics: LiveMetricsData | null): boolean {
  if (!metrics) return false;
  return metrics.deferred > 0 || metrics.queueDepth >= 8;
}

export function isTranscriptDelayed(input: {
  captureFeedback: LiveCaptureFeedback;
  liveSessionState: LiveSessionState | null;
  lastTranscriptAt: string | null;
  nowMs: number;
  transcriptDelayMs?: number;
}): boolean {
  const threshold = input.transcriptDelayMs ?? 8_000;
  const listening =
    input.captureFeedback === 'capturing' &&
    (input.liveSessionState === 'LISTENING' ||
      input.liveSessionState === 'CONNECTING' ||
      input.liveSessionState === null);

  if (!listening) return false;
  if (!input.lastTranscriptAt) {
    // Still waiting for the first segment — not "delayed" until the threshold.
    return false;
  }

  const last = Date.parse(input.lastTranscriptAt);
  if (Number.isNaN(last)) return false;
  return input.nowMs - last >= threshold;
}

export function deriveLiveStatusView(input: DeriveLiveStatusInput): LiveStatusView {
  const feedbackKeys: string[] = [];

  if (input.hasGaps) {
    feedbackKeys.push('gap');
  }
  if (isResearchSaturated(input.liveMetrics)) {
    feedbackKeys.push('research_saturated');
  }
  if (
    isTranscriptDelayed({
      captureFeedback: input.captureFeedback,
      liveSessionState: input.liveSessionState,
      lastTranscriptAt: input.lastTranscriptAt,
      nowMs: input.nowMs,
      transcriptDelayMs: input.transcriptDelayMs,
    })
  ) {
    feedbackKeys.push('transcript_delayed');
  }

  switch (input.captureFeedback) {
    case 'requesting_permission':
      return { tone: 'running', messageKey: 'requesting_permission', feedbackKeys };
    case 'permission_error':
      return { tone: 'error', messageKey: 'permission_error', feedbackKeys };
    case 'unsupported':
      return { tone: 'error', messageKey: 'unsupported', feedbackKeys };
    case 'no_audio':
      return { tone: 'warning', messageKey: 'no_audio', feedbackKeys };
    case 'connection_error':
      return { tone: 'error', messageKey: 'connection_error', feedbackKeys };
    case 'ending':
      return { tone: 'warning', messageKey: 'ending', feedbackKeys };
    case 'ended':
      return { tone: 'ended', messageKey: 'ended', feedbackKeys };
    case 'paused':
      return { tone: 'paused', messageKey: 'paused', feedbackKeys };
    case 'capturing':
      feedbackKeys.unshift('capture_active');
      if (input.liveSessionState === 'RECONNECTING') {
        return { tone: 'warning', messageKey: 'reconnecting', feedbackKeys };
      }
      if (input.liveSessionState === 'CONNECTING') {
        return { tone: 'running', messageKey: 'connecting', feedbackKeys };
      }
      return { tone: 'running', messageKey: 'listening', feedbackKeys };
    case 'idle':
      break;
    default: {
      const _exhaustive: never = input.captureFeedback;
      void _exhaustive;
      break;
    }
  }

  switch (input.liveSessionState) {
    case 'CONNECTING':
      return { tone: 'running', messageKey: 'connecting', feedbackKeys };
    case 'LISTENING':
      feedbackKeys.unshift('capture_active');
      return { tone: 'running', messageKey: 'listening', feedbackKeys };
    case 'PAUSED':
      return { tone: 'paused', messageKey: 'paused', feedbackKeys };
    case 'ENDING':
      return { tone: 'warning', messageKey: 'ending', feedbackKeys };
    case 'ENDED':
      return { tone: 'ended', messageKey: 'ended', feedbackKeys };
    case 'RECONNECTING':
      return { tone: 'warning', messageKey: 'reconnecting', feedbackKeys };
    case 'ERROR':
      return { tone: 'error', messageKey: 'session_error', feedbackKeys };
    case 'IDLE':
    case null:
      return { tone: 'idle', messageKey: 'idle', feedbackKeys };
    default: {
      const _exhaustive: never = input.liveSessionState;
      void _exhaustive;
      return { tone: 'idle', messageKey: 'idle', feedbackKeys };
    }
  }
}

/** Maps MicCaptureError / AudioChunkerError codes to capture feedback. */
export function captureFeedbackFromErrorCode(
  code: string,
): LiveCaptureFeedback {
  switch (code) {
    case 'UNSUPPORTED':
    case 'INSECURE_CONTEXT':
    case 'UNSUPPORTED_AUDIO_CONTEXT':
    case 'UNSUPPORTED_AUDIO_WORKLET':
      return 'unsupported';
    case 'PERMISSION_DENIED':
    case 'ABORTED':
      return 'permission_error';
    case 'NO_AUDIO_TRACK':
    case 'NO_DEVICE':
    case 'DEVICE_IN_USE':
    case 'DEVICE_DISCONNECTED':
      return 'no_audio';
    default:
      return 'connection_error';
  }
}

export function mapCaptureErrorMessage(
  code: string,
  fallback: string,
): { feedback: LiveCaptureFeedback; messageKey: string; fallback: string } {
  const feedback = captureFeedbackFromErrorCode(code);
  return {
    feedback,
    messageKey: feedback,
    fallback,
  };
}
