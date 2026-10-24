/* global MediaDeviceInfo, MediaDevices, MediaStream, MediaStreamConstraints, MediaStreamTrack, MediaTrackConstraints */
/**
 * Microphone capture for Veritas Live (replaces tab capture, decided on
 * 2026-10-23: tab sharing via `getDisplayMedia` was unreliable for the pilot).
 *
 * `getUserMedia({ audio })` records the room through the selected microphone.
 * Only the audio track leaves this module; the chunker/ACK pipeline downstream
 * is unchanged (it resamples to 16 kHz mono PCM16 whatever the device rate).
 *
 * Browser globals are only touched inside functions (or injected), so importing
 * this module in Node (tests, SSR) is safe. Nothing here starts a capture
 * automatically and nothing restarts one: a new capture needs a new click.
 */

export type MicCaptureErrorCode =
  /** No `navigator.mediaDevices.getUserMedia` in this browser. */
  | 'UNSUPPORTED'
  /** Page is not https/localhost, so the browser hides the microphone API. */
  | 'INSECURE_CONTEXT'
  /** The user (or a browser policy) denied microphone access. */
  | 'PERMISSION_DENIED'
  /** No microphone is connected, or the selected one is gone. */
  | 'NO_DEVICE'
  /** The microphone exists but another app/OS is holding it. */
  | 'DEVICE_IN_USE'
  /** The capture started but the device was unplugged / the track ended. */
  | 'DEVICE_DISCONNECTED'
  /** The stream came back without a live audio track. */
  | 'NO_AUDIO_TRACK'
  /** Anything else the browser threw. */
  | 'CAPTURE_FAILED';

/** User-facing messages, one per error code. Pass `t.live.micErrors`. */
export type MicCaptureMessages = Record<MicCaptureErrorCode, string>;

/** pt-BR fallback (product default). The UI passes the active locale. */
export const DEFAULT_MIC_CAPTURE_MESSAGES: MicCaptureMessages = {
  UNSUPPORTED:
    'Este navegador não permite acessar o microfone. Use uma versão recente do Chrome, Edge, Safari ou Firefox.',
  INSECURE_CONTEXT:
    'O microfone só funciona em páginas seguras. Abra o Veritas em https:// ou em http://localhost.',
  PERMISSION_DENIED:
    'O acesso ao microfone foi negado. Libere o microfone nas permissões do site (ícone ao lado do endereço) e tente de novo.',
  NO_DEVICE:
    'Nenhum microfone encontrado. Conecte um microfone e tente de novo.',
  DEVICE_IN_USE:
    'O microfone está sendo usado por outro app ou bloqueado pelo sistema. Feche o outro app e tente de novo.',
  DEVICE_DISCONNECTED:
    'O microfone foi desconectado. A escuta foi encerrada; conecte o microfone e inicie de novo.',
  NO_AUDIO_TRACK: 'O microfone não enviou áudio. Tente outro microfone.',
  CAPTURE_FAILED: 'Não foi possível acessar o microfone.',
};

export class MicCaptureError extends Error {
  readonly code: MicCaptureErrorCode;

  constructor(
    code: MicCaptureErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'MicCaptureError';
    this.code = code;
  }
}

export interface AudioCaptureEndInfo {
  reason: 'device-disconnected' | 'stopped';
}

/** Capture handle consumed by the live session controller. */
export interface AudioCapture {
  readonly stream: MediaStream;
  readonly audioTrack: MediaStreamTrack;
  readonly active: boolean;
  /** Device actually used (from track settings), when the browser exposes it. */
  readonly deviceId: string | null;
  readonly label: string;
  /** Releases the microphone. Idempotent. Does not fire `onEnded`. */
  stop(): void;
  /** Fires once when the track ends on its own (device unplugged, revoked…). */
  onEnded(listener: (info: AudioCaptureEndInfo) => void): () => void;
  onError(listener: (error: MicCaptureError) => void): () => void;
}

export interface MicrophoneDevice {
  deviceId: string;
  /** Empty until the user grants microphone permission once. */
  label: string;
}

/** Minimal surface of `navigator.mediaDevices` we use (injectable in tests). */
export interface MediaDevicesLike {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
}

export interface MicEnvironment {
  mediaDevices?: MediaDevicesLike;
  isSecureContext?: boolean;
}

export interface StartMicCaptureOptions extends MicEnvironment {
  /** `undefined`/`''`/`'default'` = system default microphone. */
  deviceId?: string;
  messages?: Partial<MicCaptureMessages>;
}

/**
 * Speech in a room:
 * - noiseSuppression + autoGainControl ON: removes fan/AC hiss and levels
 *   distant vs. close speakers, which helps transcription.
 * - echoCancellation OFF: AEC removes whatever the same computer is playing.
 *   If the debate plays on this laptop's speakers, AEC would erase it.
 * - mono; 16 kHz is only a hint (`ideal`) — the chunker resamples anyway.
 */
export const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 16000 },
};

export function buildMicConstraints(deviceId?: string): MediaStreamConstraints {
  const useDefault = !deviceId || deviceId === 'default';
  return {
    audio: useDefault
      ? { ...MIC_AUDIO_CONSTRAINTS }
      : { ...MIC_AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } },
    video: false,
  };
}

function resolveEnv(env: MicEnvironment): {
  mediaDevices: MediaDevicesLike | undefined;
  secure: boolean;
} {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const mediaDevices =
    env.mediaDevices ?? (nav?.mediaDevices as MediaDevices | undefined);
  const secure =
    env.isSecureContext ??
    (typeof globalThis.isSecureContext === 'boolean'
      ? globalThis.isSecureContext
      : true);
  return { mediaDevices, secure };
}

function messagesWith(
  overrides?: Partial<MicCaptureMessages>,
): MicCaptureMessages {
  return { ...DEFAULT_MIC_CAPTURE_MESSAGES, ...overrides };
}

/** Why the microphone cannot be used here, or `null` when it can. */
export function getMicSupportProblem(
  env: MicEnvironment = {},
): 'INSECURE_CONTEXT' | 'UNSUPPORTED' | null {
  const { mediaDevices, secure } = resolveEnv(env);
  // Insecure pages hide `navigator.mediaDevices` entirely, so check it first
  // to give the actionable message instead of "unsupported browser".
  if (!secure) return 'INSECURE_CONTEXT';
  if (typeof mediaDevices?.getUserMedia !== 'function') return 'UNSUPPORTED';
  return null;
}

/** Maps a `getUserMedia` rejection to a stable code + localized message. */
export function mapUserMediaError(
  error: unknown,
  overrides?: Partial<MicCaptureMessages>,
): MicCaptureError {
  if (error instanceof MicCaptureError) return error;
  const messages = messagesWith(overrides);
  const name =
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name
      : '';

  const make = (code: MicCaptureErrorCode) =>
    new MicCaptureError(code, messages[code], { cause: error });

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return make('PERMISSION_DENIED');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError': // `deviceId: { exact }` of an unplugged mic
    case 'ConstraintNotSatisfiedError':
      return make('NO_DEVICE');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return make('DEVICE_IN_USE');
    case 'TypeError':
    case 'NotSupportedError':
      return make('UNSUPPORTED');
    default:
      return make('CAPTURE_FAILED');
  }
}

/**
 * Lists audio inputs. Labels are empty until permission was granted once;
 * the UI then shows only "default microphone".
 */
export async function listMicrophones(
  env: MicEnvironment = {},
): Promise<MicrophoneDevice[]> {
  const { mediaDevices } = resolveEnv(env);
  if (typeof mediaDevices?.enumerateDevices !== 'function') return [];
  let devices: MediaDeviceInfo[];
  try {
    devices = await mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const result: MicrophoneDevice[] = [];
  for (const device of devices) {
    if (device.kind !== 'audioinput') continue;
    // Chrome lists a virtual "default" entry; the picker has its own default.
    if (device.deviceId === 'default' || device.deviceId === '') continue;
    if (seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    result.push({
      deviceId: device.deviceId,
      label: device.label,
    });
  }
  return result;
}

/**
 * Asks for microphone permission (from a click) only to reveal device labels,
 * then releases the mic immediately.
 */
export async function requestMicrophoneList(
  options: StartMicCaptureOptions = {},
): Promise<MicrophoneDevice[]> {
  const capture = await startMicCapture(options);
  capture.stop();
  return listMicrophones(options);
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Already gone.
    }
  }
}

/**
 * Opens the microphone. **Call from a click handler.** Rejects with a
 * `MicCaptureError`; never leaves a track running on failure.
 */
export async function startMicCapture(
  options: StartMicCaptureOptions = {},
): Promise<AudioCapture> {
  const messages = messagesWith(options.messages);
  const problem = getMicSupportProblem(options);
  if (problem) {
    throw new MicCaptureError(problem, messages[problem]);
  }

  const { mediaDevices } = resolveEnv(options);
  let stream: MediaStream;
  try {
    stream = await mediaDevices!.getUserMedia!(
      buildMicConstraints(options.deviceId),
    );
  } catch (error) {
    throw mapUserMediaError(error, options.messages);
  }

  const audioTrack = stream?.getAudioTracks?.()[0];
  if (!audioTrack || audioTrack.readyState === 'ended') {
    if (stream) stopTracks(stream);
    throw new MicCaptureError('NO_AUDIO_TRACK', messages.NO_AUDIO_TRACK);
  }

  return new MicCaptureSession(stream, audioTrack, messages);
}

class MicCaptureSession implements AudioCapture {
  readonly stream: MediaStream;
  readonly audioTrack: MediaStreamTrack;
  readonly deviceId: string | null;
  readonly label: string;

  private readonly endedListeners = new Set<(info: AudioCaptureEndInfo) => void>();
  private readonly errorListeners = new Set<(error: MicCaptureError) => void>();
  private activeCapture = true;

  constructor(
    stream: MediaStream,
    audioTrack: MediaStreamTrack,
    private readonly messages: MicCaptureMessages,
  ) {
    this.stream = stream;
    this.audioTrack = audioTrack;
    const settings =
      typeof audioTrack.getSettings === 'function' ? audioTrack.getSettings() : {};
    this.deviceId = settings.deviceId ?? null;
    this.label = audioTrack.label ?? '';
    audioTrack.addEventListener('ended', this.handleEnded);
  }

  get active(): boolean {
    return this.activeCapture;
  }

  stop(): void {
    if (!this.activeCapture) return;
    this.activeCapture = false;
    this.audioTrack.removeEventListener('ended', this.handleEnded);
    stopTracks(this.stream);
    this.endedListeners.clear();
    this.errorListeners.clear();
  }

  onEnded(listener: (info: AudioCaptureEndInfo) => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  onError(listener: (error: MicCaptureError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Track ended without `stop()`: device unplugged or permission revoked. */
  private readonly handleEnded = (): void => {
    if (!this.activeCapture) return;
    this.activeCapture = false;
    this.audioTrack.removeEventListener('ended', this.handleEnded);
    stopTracks(this.stream);
    const error = new MicCaptureError(
      'DEVICE_DISCONNECTED',
      this.messages.DEVICE_DISCONNECTED,
    );
    for (const listener of [...this.errorListeners]) {
      try {
        listener(error);
      } catch {
        // A broken listener must not break teardown.
      }
    }
    for (const listener of [...this.endedListeners]) {
      try {
        listener({ reason: 'device-disconnected' });
      } catch {
        // idem
      }
    }
  };
}
