/**
 * Speaker identification for the live pipeline (LIVE-010 / LIVE-011).
 *
 * Two independent concerns, kept strictly apart:
 *
 * - {@link DiarizationProvider}: acoustic evidence only. It answers "which
 *   voice cluster spoke in this window" with an opaque provider label.
 * - {@link SpeakerRegistry}: turns provider labels into stable session ids
 *   (`speaker-1`, `speaker-2`, …) and is the **only** place where a human name
 *   can be attached — and only through an explicit, revision-checked manual
 *   mapping.
 *
 * There is deliberately no text, turn-order or political-content heuristic:
 * identity is never inferred from what was said. Unknown stays unknown.
 */
import type { SpeakerMapping } from '@veritas/shared';
import { pcm16ToWav, samplesToMs } from './wav.js';

// ===== Diarization contract =====
export type SpeakerObservation = {
  speakerLabel: string;
  confidence?: number;
  /** Start of this speaker turn relative to the submitted PCM window. */
  startMs?: number;
  /** End of this speaker turn relative to the submitted PCM window. */
  endMs?: number;
};

/** Provisional gate; LIVE-000/034 must calibrate it on the reserved corpus. */
export const DEFAULT_SPEAKER_MIN_CONFIDENCE = 0.75;

export type DiarizationOptions = {
  /** Stable live session id; providers should keep speaker labels stable for it. */
  sessionId?: string;
  /** Media time of the first sample in `pcm`, in milliseconds. */
  startMs: number;
  /** Media time of the last sample in `pcm`, in milliseconds. */
  endMs: number;
  signal?: AbortSignal;
};

export interface DiarizationProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  identify(
    pcm: Buffer,
    options: DiarizationOptions,
  ): Promise<SpeakerObservation[]>;
}

// ===== Errors =====
export class SpeakerIdentificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeakerIdentificationError';
  }
}

export class DiarizationUnavailableError extends SpeakerIdentificationError {
  constructor(message: string) {
    super(message);
    this.name = 'DiarizationUnavailableError';
  }
}

export class DiarizationTimeoutError extends SpeakerIdentificationError {
  constructor(timeoutMs: number) {
    super(`Diarização excedeu o tempo limite de ${String(timeoutMs)} ms`);
    this.name = 'DiarizationTimeoutError';
  }
}

export class DiarizationAbortedError extends SpeakerIdentificationError {
  constructor() {
    super('Diarização cancelada antes de concluir');
    this.name = 'AbortError';
  }
}

export class SpeakerRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeakerRegistryError';
  }
}

export class UnknownSpeakerError extends SpeakerRegistryError {
  constructor(speakerId: string) {
    super(
      `Locutor "${speakerId}" não foi observado nesta sessão; associe apenas locutores conhecidos`,
    );
    this.name = 'UnknownSpeakerError';
  }
}

export class SpeakerMappingConflictError extends SpeakerRegistryError {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Revisão do mapeamento de locutores mudou (esperada ${String(expectedRevision)}, atual ${String(actualRevision)})`,
    );
    this.name = 'SpeakerMappingConflictError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class SpeakerMappingValidationError extends SpeakerRegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'SpeakerMappingValidationError';
  }
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted === true) {
    throw new DiarizationAbortedError();
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readLabel = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value.trim() : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

const readConfidence = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return undefined;
};

// ===== Unknown speaker fallback =====
/**
 * Always usable fallback: returns no labels, so the transcript keeps the
 * speaker unknown. Never invents a name or a participant.
 */
export class UnknownSpeakerProvider implements DiarizationProvider {
  readonly name = 'unknown-speaker';

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  identify(): Promise<SpeakerObservation[]> {
    return Promise.resolve([]);
  }
}

// ===== Pyannote HTTP adapter =====
export const DEFAULT_PYANNOTE_TIMEOUT_MS = 15_000;
export const DEFAULT_PYANNOTE_PROBE_TIMEOUT_MS = 2_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type PyannoteHttpAdapterOptions = {
  url?: string;
  timeoutMs?: number;
  probeTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
};

const readPositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Pure parser for a pyannote HTTP response.
 *
 * Tolerated shapes: `[{speaker|label, confidence|score, start, end}]`,
 * `{segments: [...]}` and `{diarization: [...]}`. Time bounds may be
 * `start_ms`/`end_ms` or `start`/`end` in seconds. Timed turns are preserved;
 * untimed duplicate labels are collapsed at their highest confidence.
 * Unknown shapes yield `[]` rather than a guess.
 */
export function parsePyannoteResponse(payload: unknown): SpeakerObservation[] {
  const byLabel = new Map<string, SpeakerObservation>();
  const timed: SpeakerObservation[] = [];
  for (const item of extractSegmentList(payload)) {
    if (!isRecord(item)) {
      continue;
    }
    const label =
      readLabel(item['speaker']) ??
      readLabel(item['label']) ??
      readLabel(item['speakerLabel']);
    if (label === undefined) {
      continue;
    }
    const confidence =
      readConfidence(item['confidence']) ?? readConfidence(item['score']);
    const startMs = readTimeMs(item, 'start_ms', 'start');
    const endMs = readTimeMs(item, 'end_ms', 'end');
    if (startMs !== undefined && endMs !== undefined && endMs > startMs) {
      timed.push({
        speakerLabel: label,
        ...(confidence === undefined ? {} : { confidence }),
        startMs,
        endMs,
      });
      continue;
    }
    const existing = byLabel.get(label);
    if (existing === undefined) {
      byLabel.set(
        label,
        confidence === undefined
          ? { speakerLabel: label }
          : { speakerLabel: label, confidence },
      );
      continue;
    }
    if (
      confidence !== undefined &&
      (existing.confidence === undefined || confidence > existing.confidence)
    ) {
      existing.confidence = confidence;
    }
  }
  return [...timed, ...byLabel.values()];
}

const readTimeMs = (
  item: Record<string, unknown>,
  millisecondsKey: string,
  secondsKey: string,
): number | undefined => {
  const milliseconds = item[millisecondsKey];
  if (typeof milliseconds === 'number' && Number.isFinite(milliseconds)) {
    return Math.max(0, milliseconds);
  }
  const seconds = item[secondsKey];
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  return undefined;
};

/**
 * Resolves a transcript interval only when one diarized speaker clearly owns
 * it. Any untimed multi-speaker result, material overlap, or weak coverage is
 * intentionally left unattributed.
 */
export function resolveSpeakerLabelForInterval(
  observations: readonly SpeakerObservation[],
  startMs: number,
  endMs: number,
  windowDurationMs: number,
): string | undefined {
  const duration = endMs - startMs;
  if (duration <= 0 || observations.length === 0) {
    return undefined;
  }
  const uniqueLabels = new Set(
    observations.map(({ speakerLabel }) => speakerLabel),
  );
  const intervalsByLabel = new Map<string, Array<[number, number]>>();
  for (const observation of observations) {
    if (
      observation.confidence !== undefined &&
      observation.confidence < DEFAULT_SPEAKER_MIN_CONFIDENCE
    ) {
      continue;
    }
    const hasRange =
      observation.startMs !== undefined && observation.endMs !== undefined;
    if (!hasRange && uniqueLabels.size !== 1) {
      return undefined;
    }
    const from = hasRange ? observation.startMs! : 0;
    const to = hasRange ? observation.endMs! : windowDurationMs;
    const clippedFrom = Math.max(startMs, from);
    const clippedTo = Math.min(endMs, to);
    if (clippedTo > clippedFrom) {
      const intervals = intervalsByLabel.get(observation.speakerLabel) ?? [];
      intervals.push([clippedFrom, clippedTo]);
      intervalsByLabel.set(observation.speakerLabel, intervals);
    }
  }
  const coverageByLabel = [...intervalsByLabel.entries()].map(
    ([label, intervals]) => {
      intervals.sort((left, right) => left[0] - right[0]);
      let coveredMs = 0;
      let rangeStart = -1;
      let rangeEnd = -1;
      for (const [from, to] of intervals) {
        if (rangeStart < 0) {
          rangeStart = from;
          rangeEnd = to;
        } else if (from <= rangeEnd) {
          rangeEnd = Math.max(rangeEnd, to);
        } else {
          coveredMs += rangeEnd - rangeStart;
          rangeStart = from;
          rangeEnd = to;
        }
      }
      if (rangeStart >= 0) {
        coveredMs += rangeEnd - rangeStart;
      }
      return [label, coveredMs] as const;
    },
  );
  const ranked = coverageByLabel.sort((left, right) => right[1] - left[1]);
  const best = ranked.at(0);
  if (best === undefined) {
    return undefined;
  }
  const coverage = best[1] / duration;
  const secondCoverage = (ranked[1]?.[1] ?? 0) / duration;
  if (
    coverage < 0.6 ||
    secondCoverage >= 0.2 ||
    coverage - secondCoverage < 0.2
  ) {
    return undefined;
  }
  return best[0];
}

const extractSegmentList = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) {
    return [...(payload as unknown[])];
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of ['segments', 'diarization', 'results']) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return [...(candidate as unknown[])];
    }
  }
  return [];
};

/**
 * Local pyannote (or compatible) HTTP adapter.
 *
 * Not bundled and not assumed installed: without `PYANNOTE_URL` the adapter is
 * unavailable. Audio is posted as WAV to the operator-provided endpoint — it
 * never leaves the local network unless the operator configured it that way.
 * Only session-local windows are sent; nothing is logged. The configured
 * service must use the supplied session id for stable speaker clusters and
 * return turn timestamps relative to the submitted window when continuity is
 * required.
 */
export class PyannoteHttpAdapter implements DiarizationProvider {
  readonly name = 'pyannote-http';

  private readonly url?: string;
  private readonly timeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private availability?: Promise<boolean>;

  constructor(options: PyannoteHttpAdapterOptions = {}) {
    const env = options.env ?? process.env;
    const url = options.url?.trim() ?? env['PYANNOTE_URL']?.trim();
    this.url = url !== undefined && url.length > 0 ? url : undefined;
    this.timeoutMs =
      options.timeoutMs ??
      readPositiveInt(env['PYANNOTE_TIMEOUT_MS'], DEFAULT_PYANNOTE_TIMEOUT_MS);
    this.probeTimeoutMs =
      options.probeTimeoutMs ?? DEFAULT_PYANNOTE_PROBE_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  isAvailable(): Promise<boolean> {
    this.availability ??= this.probe();
    return this.availability;
  }

  /** Test hook: forgets the cached endpoint probe. */
  resetAvailabilityCache(): void {
    delete this.availability;
  }

  async identify(
    pcm: Buffer,
    options: DiarizationOptions,
  ): Promise<SpeakerObservation[]> {
    throwIfAborted(options.signal);
    if (pcm.length === 0) {
      return [];
    }
    const url = this.url;
    if (url === undefined) {
      throw new DiarizationUnavailableError(
        'Diarização indisponível: defina PYANNOTE_URL para o serviço local qualificado (LIVE-000).',
      );
    }

    const wav = pcm16ToWav(pcm, 16000, 1);
    const controller = new AbortController();
    const timeoutState = { fired: false };
    const timer = setTimeout(() => {
      timeoutState.fired = true;
      controller.abort();
    }, this.timeoutMs);
    const forwardAbort = (): void => {
      controller.abort();
    };
    options.signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const response = await this.fetchImpl(this.endpoint(url, options), {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: new Uint8Array(wav),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SpeakerIdentificationError(
          `Serviço de diarização retornou HTTP ${String(response.status)}`,
        );
      }
      const payload = (await response.json()) as unknown;
      return parsePyannoteResponse(payload);
    } catch (error) {
      if (isAbortError(error)) {
        throw timeoutState.fired
          ? new DiarizationTimeoutError(this.timeoutMs)
          : new DiarizationAbortedError();
      }
      if (error instanceof SpeakerIdentificationError) {
        throw error;
      }
      throw new SpeakerIdentificationError(
        'Falha ao consultar o serviço de diarização',
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private endpoint(url: string, options: DiarizationOptions): string {
    const separator = url.includes('?') ? '&' : '?';
    const params = new URLSearchParams({
      start_ms: String(Math.max(0, Math.round(options.startMs))),
      end_ms: String(Math.max(0, Math.round(options.endMs))),
      sample_rate: '16000',
    });
    if (options.sessionId !== undefined) {
      params.set('session_id', options.sessionId);
    }
    return `${url}${separator}${params.toString()}`;
  }

  private async probe(): Promise<boolean> {
    if (this.url === undefined) {
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.probeTimeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'GET',
        signal: controller.signal,
      });
      // Any HTTP answer below 500 proves the endpoint exists; 5xx is unhealthy.
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ===== Session speaker registry =====
export type SetSpeakerMappingOptions = {
  /** A mapping is only "confirmed" after an explicit user action. */
  confirmed?: boolean;
};

/**
 * Maps opaque provider labels to stable session ids and stores the optional,
 * human-confirmed participant names.
 *
 * Invariants:
 * - `observe()` assigns ids in first-seen order (`speaker-1`, `speaker-2`, …)
 *   and never assigns names;
 * - `setMapping()` is the only way to attach a name, requires a known speaker
 *   and a current `expectedRevision`, and bumps the session revision;
 * - unknown labels/ids never produce a name — they stay `undefined`.
 */
export class SpeakerRegistry {
  private readonly labelToSpeakerId = new Map<string, string>();
  private readonly speakerIdToLabel = new Map<string, string>();
  private readonly mappings = new Map<string, SpeakerMapping>();
  private readonly speakerOrder: string[] = [];
  private nextSpeakerNumber = 1;
  private revision = 0;

  /** Registers a provider label, returning its stable session speaker id. */
  observe(label: string): string {
    const normalized = label.trim();
    if (normalized.length === 0) {
      throw new SpeakerMappingValidationError(
        'Rótulo de locutor vazio não pode ser associado',
      );
    }
    const existing = this.labelToSpeakerId.get(normalized);
    if (existing !== undefined) {
      return existing;
    }
    const speakerId = `speaker-${String(this.nextSpeakerNumber)}`;
    this.nextSpeakerNumber += 1;
    this.labelToSpeakerId.set(normalized, speakerId);
    this.speakerIdToLabel.set(speakerId, normalized);
    this.speakerOrder.push(speakerId);
    return speakerId;
  }

  /** Existing id for a provider label; `undefined` when never observed. */
  getSpeakerId(label: string): string | undefined {
    return this.labelToSpeakerId.get(label.trim());
  }

  /** Provider label behind a session speaker id (audit only). */
  getSpeakerLabel(speakerId: string): string | undefined {
    return this.speakerIdToLabel.get(speakerId);
  }

  /** Session speaker ids in first-seen order. */
  getSpeakerIds(): string[] {
    return [...this.speakerOrder];
  }

  getRevision(): number {
    return this.revision;
  }

  /**
   * Attaches a participant name to an observed speaker. Throws on a stale
   * `expectedRevision` or an unknown speaker; never fabricates a mapping.
   */
  setMapping(
    speakerId: string,
    participantName: string,
    expectedRevision: number,
    options: SetSpeakerMappingOptions = {},
  ): SpeakerMapping {
    if (!this.speakerIdToLabel.has(speakerId)) {
      throw new UnknownSpeakerError(speakerId);
    }
    if (expectedRevision !== this.revision) {
      throw new SpeakerMappingConflictError(expectedRevision, this.revision);
    }
    const name = participantName.trim();
    if (name.length === 0) {
      throw new SpeakerMappingValidationError(
        'Nome do participante não pode ser vazio',
      );
    }

    this.revision += 1;
    const mapping: SpeakerMapping = {
      speakerId,
      participantName: name,
      confirmed: options.confirmed ?? false,
      revision: this.revision,
    };
    this.mappings.set(speakerId, mapping);
    return { ...mapping };
  }

  /** Marks an existing mapping as confirmed by the user. */
  confirmMapping(speakerId: string, expectedRevision: number): SpeakerMapping {
    const current = this.mappings.get(speakerId);
    if (current === undefined) {
      throw new SpeakerMappingValidationError(
        `Locutor "${speakerId}" não possui mapeamento para confirmar`,
      );
    }
    if (expectedRevision !== this.revision) {
      throw new SpeakerMappingConflictError(expectedRevision, this.revision);
    }
    this.revision += 1;
    const mapping: SpeakerMapping = {
      ...current,
      confirmed: true,
      revision: this.revision,
    };
    this.mappings.set(speakerId, mapping);
    return { ...mapping };
  }

  /** Current mappings in first-seen speaker order. */
  getMappings(): SpeakerMapping[] {
    return this.speakerOrder
      .map((speakerId) => this.mappings.get(speakerId))
      .filter((mapping): mapping is SpeakerMapping => mapping !== undefined)
      .map((mapping) => ({ ...mapping }));
  }

  getMapping(speakerId: string): SpeakerMapping | undefined {
    const mapping = this.mappings.get(speakerId);
    return mapping === undefined ? undefined : { ...mapping };
  }

  /**
   * Human name for a speaker id, only when a manual mapping exists. Unknown or
   * unmapped speakers return `undefined` — callers must render "desconhecido".
   */
  getParticipantName(speakerId: string): string | undefined {
    return this.mappings.get(speakerId)?.participantName;
  }

  /**
   * Resolves the session speaker id carried by a segment. Unknown ids stay
   * `undefined` (authoring is never guessed).
   */
  getSpeakerIdForSegment(segment: { speakerId?: string }): string | undefined {
    const speakerId = segment.speakerId;
    if (speakerId === undefined) {
      return undefined;
    }
    return this.speakerIdToLabel.has(speakerId) ? speakerId : undefined;
  }
}

/** Utility used by callers that need the media duration of a window. */
export function windowDurationMs(pcm: Buffer, sampleRate = 16000): number {
  return samplesToMs(Math.floor(pcm.length / 2), sampleRate);
}

/**
 * Resolves the diarization adapter for a live session.
 *
 * Prefer a local/self-hosted pyannote HTTP endpoint when `PYANNOTE_URL` is set;
 * otherwise keep authorship unknown (never invent names from content or turns).
 */
export function createDiarizationProvider(
  env: NodeJS.ProcessEnv = process.env,
): DiarizationProvider {
  const url = env['PYANNOTE_URL']?.trim();
  if (url !== undefined && url.length > 0) {
    return new PyannoteHttpAdapter({ env });
  }
  return new UnknownSpeakerProvider();
}
