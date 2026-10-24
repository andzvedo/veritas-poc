/**
 * Transcription provider abstraction for the live pipeline.
 *
 * Three interchangeable adapters feed the same `TranscriptionProvider`
 * contract:
 *
 * - {@link WhisperCppAdapter}: local whisper.cpp CLI (preferred, no per-minute
 *   cost, audio never leaves the machine).
 * - {@link GeminiAudioAdapter}: opt-in cloud fallback, only reachable when
 *   `ALLOW_CLOUD_TRANSCRIPTION === 'true'` **and** a Google key is supplied.
 * - {@link UnavailableTranscriptionProvider}: explicit, actionable failure when
 *   neither is qualified/configured.
 *
 * Audio and credentials are never logged. Errors carry only safe, redacted
 * text. Timestamps returned by every adapter are relative to the start of the
 * PCM window that was submitted; the session layer adds the media offset.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { redactSecrets } from '#/utils/security.js';
import { PCM16_SAMPLE_RATE, pcm16ToWav } from './wav.js';

// ===== Contract =====
export const TRANSCRIPTION_LANGUAGE = 'pt-BR';
export const TRANSCRIPTION_SAMPLE_RATE = PCM16_SAMPLE_RATE;

export type TranscriptionOptions = {
  sampleRate: typeof TRANSCRIPTION_SAMPLE_RATE;
  language: typeof TRANSCRIPTION_LANGUAGE;
  /** Absolute media clock position of the first sample in `pcm`. */
  startSample: number;
  /** Duration of the window in milliseconds (informational for adapters). */
  durationMs: number;
  signal?: AbortSignal;
};

export type TranscribedSegment = {
  text: string;
  /** Milliseconds relative to the start of the submitted window. */
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type TranscriptionResult = {
  text: string;
  confidence?: number;
  segments?: TranscribedSegment[];
};

export interface TranscriptionProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  transcribe(
    pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}

// ===== Errors =====
export type TranscriptionErrorCode =
  | 'TRANSCRIPTION_UNAVAILABLE'
  | 'TRANSCRIPTION_ABORTED'
  | 'TRANSCRIPTION_TIMEOUT'
  | 'TRANSCRIPTION_FAILED'
  | 'TRANSCRIPTION_PARSE_ERROR'
  | 'TRANSCRIPTION_HTTP_ERROR'
  | 'TRANSCRIPTION_OUTPUT_MISSING';

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;

  constructor(code: TranscriptionErrorCode, message: string) {
    super(message);
    this.name = 'TranscriptionError';
    this.code = code;
  }
}

export class TranscriptionUnavailableError extends TranscriptionError {
  constructor(message: string) {
    super('TRANSCRIPTION_UNAVAILABLE', message);
    this.name = 'TranscriptionUnavailableError';
  }
}

export class TranscriptionAbortedError extends TranscriptionError {
  constructor(message = 'Transcrição cancelada antes de concluir') {
    super('TRANSCRIPTION_ABORTED', message);
    this.name = 'AbortError';
  }
}

export class TranscriptionTimeoutError extends TranscriptionError {
  constructor(timeoutMs: number) {
    super(
      'TRANSCRIPTION_TIMEOUT',
      `Transcrição excedeu o tempo limite de ${String(timeoutMs)} ms`,
    );
    this.name = 'TranscriptionTimeoutError';
  }
}

export class TranscriptionParseError extends TranscriptionError {
  constructor(message: string) {
    super('TRANSCRIPTION_PARSE_ERROR', message);
    this.name = 'TranscriptionParseError';
  }
}

export class TranscriptionFailedError extends TranscriptionError {
  constructor(message: string) {
    super('TRANSCRIPTION_FAILED', message);
    this.name = 'TranscriptionFailedError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new TranscriptionAbortedError();
  }
}

// ===== Process execution (injectable for tests) =====
const MAX_COMMAND_OUTPUT_CHARS = 8192;

export type CommandSpec = {
  command: string;
  args: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
};

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  /** Set when the process could not be spawned (e.g. `ENOENT`). */
  spawnErrorCode?: string;
};

export type CommandRunner = (spec: CommandSpec) => Promise<CommandResult>;

const appendCapped = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString('utf8');
  return next.length > MAX_COMMAND_OUTPUT_CHARS
    ? next.slice(-MAX_COMMAND_OUTPUT_CHARS)
    : next;
};

const errorCodeOf = (error: unknown): string | undefined => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
};

/**
 * Default runner: spawn without a shell (no argument injection), pipe output,
 * kill on timeout or abort. Never logs anything.
 */
export const defaultCommandRunner: CommandRunner = (spec) =>
  new Promise<CommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutState = { fired: false };

    const killChild = (): void => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
    };

    const onAbort = (): void => {
      killChild();
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.command, [...spec.args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false,
        spawnErrorCode: errorCodeOf(error) ?? 'SPAWN_FAILED',
      });
      return;
    }

    const timer = setTimeout(
      () => {
        timeoutState.fired = true;
        killChild();
      },
      Math.max(1, spec.timeoutMs),
    );

    const finish = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      spec.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    if (spec.signal?.aborted === true) {
      killChild();
      finish({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: true,
      });
      return;
    }
    spec.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.on('error', (error: Error) => {
      finish({
        code: null,
        stdout,
        stderr,
        timedOut: timeoutState.fired,
        aborted: spec.signal?.aborted === true,
        spawnErrorCode: errorCodeOf(error) ?? 'SPAWN_FAILED',
      });
    });
    child.on('close', (code: number | null) => {
      finish({
        code,
        stdout,
        stderr,
        timedOut: timeoutState.fired,
        aborted: spec.signal?.aborted === true,
      });
    });
  });

// ===== whisper.cpp adapter =====
export const DEFAULT_WHISPER_BIN = 'whisper-cli';
export const DEFAULT_WHISPER_TIMEOUT_MS = 60_000;
export const DEFAULT_WHISPER_PROBE_TIMEOUT_MS = 3_000;

export type WhisperCppAdapterOptions = {
  binPath?: string;
  modelPath?: string;
  timeoutMs?: number;
  probeTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
};

const trimToUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
};

const readPositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const WHISPER_TIMESTAMP_PATTERN =
  /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/;

/** Parses whisper.cpp `HH:MM:SS,mmm` timestamps into milliseconds. */
export function parseWhisperTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = WHISPER_TIMESTAMP_PATTERN.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const hours = groupAt(match, 1);
  const minutes = groupAt(match, 2);
  const seconds = groupAt(match, 3);
  const millis = groupAt(match, 4);
  const hoursMs = Number(hours ?? '0') * 3_600_000;
  const minutesMs = Number(minutes ?? '0') * 60_000;
  const secondsMs = Number(seconds ?? '0') * 1000;
  // `,1` means 100 ms, `,12` means 120 ms, `,123` means 123 ms.
  const fractionMs = Number((millis ?? '0').padEnd(3, '0'));
  return hoursMs + minutesMs + secondsMs + fractionMs;
}

const groupAt = (
  groups: readonly string[],
  index: number,
): string | undefined => groups[index];

const avgLogprobToConfidence = (value: unknown): number | undefined => {
  const logprob = readFiniteNumber(value);
  if (logprob === undefined) {
    return undefined;
  }
  // whisper.cpp reports the average token log-probability (<= 0); exp() maps it
  // back to a 0..1 sequence probability. This is a derived signal, not a
  // calibrated confidence — documented as such.
  return Math.min(1, Math.max(0, Math.exp(logprob)));
};

const averageDefined = (values: number[]): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.min(1, Math.max(0, total / values.length));
};

/**
 * Pure parser for `whisper-cli -oj` output. Tolerates builds that name the
 * segment array `transcription` (current) or `segments` (older) and builds
 * without `offsets` (falls back to `timestamps` strings).
 */
export function parseWhisperResult(value: unknown): TranscriptionResult {
  if (!isRecord(value)) {
    throw new TranscriptionParseError(
      'Saída do whisper.cpp não é um objeto JSON',
    );
  }

  const candidateLists: unknown[] = [value['transcription'], value['segments']];
  const rawList = candidateLists.find((item) => Array.isArray(item));
  const items: unknown[] = Array.isArray(rawList) ? rawList : [];

  const segments: TranscribedSegment[] = [];
  let cursorMs = 0;

  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const text = typeof item['text'] === 'string' ? item['text'].trim() : '';
    if (text.length === 0) {
      continue;
    }
    const offsets = isRecord(item['offsets']) ? item['offsets'] : undefined;
    const timestamps = isRecord(item['timestamps'])
      ? item['timestamps']
      : undefined;
    const startMs = Math.max(
      cursorMs,
      readFiniteNumber(offsets?.['from']) ??
        parseWhisperTimestamp(timestamps?.['from']) ??
        cursorMs,
    );
    const endMs = Math.max(
      startMs,
      readFiniteNumber(offsets?.['to']) ??
        parseWhisperTimestamp(timestamps?.['to']) ??
        startMs,
    );
    const confidence =
      readFiniteNumber(item['probability']) ??
      avgLogprobToConfidence(item['avg_logprob']);

    segments.push(
      confidence === undefined
        ? { text, startMs, endMs }
        : { text, startMs, endMs, confidence },
    );
    cursorMs = endMs;
  }

  const topLevelText =
    typeof value['text'] === 'string' ? value['text'].trim() : '';
  const text =
    segments.length > 0
      ? segments
          .map((segment) => segment.text)
          .join(' ')
          .trim()
      : topLevelText;
  const confidence = averageDefined(
    segments
      .map((segment) => segment.confidence)
      .filter((value): value is number => value !== undefined),
  );

  return confidence === undefined
    ? { text, segments }
    : { text, segments, confidence };
}

/** Pure parser for the raw JSON document written by whisper.cpp. */
export function parseWhisperJson(raw: string): TranscriptionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TranscriptionParseError('Saída do whisper.cpp não é JSON válido');
  }
  return parseWhisperResult(parsed);
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
};

/**
 * Local whisper.cpp CLI adapter.
 *
 * Availability is probed once (cached): the binary must answer `--help` within
 * a bounded timeout and `WHISPER_CPP_MODEL` must point to a file. Neither
 * whisper.cpp nor a model is bundled — this environment does not have them, so
 * `isAvailable()` resolves `false` unless the operator qualified LIVE-000.
 *
 * Each window is written to a private temp directory, transcribed, parsed and
 * the directory is always removed. Audio is never logged.
 */
export class WhisperCppAdapter implements TranscriptionProvider {
  readonly name = 'whisper-cpp';

  private readonly binPath: string;
  private readonly modelPath?: string;
  private readonly timeoutMs: number;
  private readonly probeTimeoutMs: number;
  private readonly runner: CommandRunner;
  private availability?: Promise<boolean>;

  constructor(options: WhisperCppAdapterOptions = {}) {
    const env = options.env ?? process.env;
    this.binPath =
      trimToUndefined(options.binPath) ??
      trimToUndefined(env['WHISPER_CPP_BIN']) ??
      DEFAULT_WHISPER_BIN;
    this.modelPath =
      trimToUndefined(options.modelPath) ??
      trimToUndefined(env['WHISPER_CPP_MODEL']);
    this.timeoutMs =
      options.timeoutMs ??
      readPositiveInt(env['WHISPER_TIMEOUT_MS'], DEFAULT_WHISPER_TIMEOUT_MS);
    this.probeTimeoutMs =
      options.probeTimeoutMs ?? DEFAULT_WHISPER_PROBE_TIMEOUT_MS;
    this.runner = options.runner ?? defaultCommandRunner;
  }

  isAvailable(): Promise<boolean> {
    this.availability ??= this.probe();
    return this.availability;
  }

  /** Test hook: forgets the cached probe result. */
  resetAvailabilityCache(): void {
    delete this.availability;
  }

  async transcribe(
    pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    throwIfAborted(options.signal);
    if (pcm.length === 0) {
      return { text: '', segments: [] };
    }
    const modelPath = this.modelPath;
    if (modelPath === undefined) {
      throw new TranscriptionUnavailableError(
        'whisper.cpp não configurado: defina WHISPER_CPP_MODEL (caminho do modelo .bin).',
      );
    }

    const workDir = join(tmpdir(), `veritas-whisper-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });
    const wavPath = join(workDir, 'input.wav');
    const outputBase = join(workDir, 'output');

    try {
      await fs.writeFile(wavPath, pcm16ToWav(pcm, options.sampleRate, 1));

      const result = await this.runWhisper(
        modelPath,
        wavPath,
        outputBase,
        options,
      );
      throwIfAborted(options.signal);
      if (result.timedOut) {
        throw new TranscriptionTimeoutError(this.timeoutMs);
      }
      if (result.spawnErrorCode !== undefined) {
        throw new TranscriptionUnavailableError(
          `whisper.cpp não pôde ser executado (${result.spawnErrorCode}). Verifique WHISPER_CPP_BIN.`,
        );
      }
      if (result.code !== 0) {
        throw new TranscriptionFailedError(
          `whisper.cpp terminou com código ${String(result.code ?? -1)}: ${summarizeCommandOutput(result)}`,
        );
      }

      const jsonText = await this.readOutputJson(outputBase, result);
      return parseWhisperJson(jsonText);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {
        // Best effort cleanup: a leaked temp dir must never mask a transcription
        // result or failure.
      });
    }
  }

  private async probe(): Promise<boolean> {
    if (this.modelPath === undefined) {
      return false;
    }
    if (!(await fileExists(this.modelPath))) {
      return false;
    }
    try {
      const result = await this.runner({
        command: this.binPath,
        args: ['--help'],
        timeoutMs: this.probeTimeoutMs,
      });
      return (
        !result.timedOut &&
        !result.aborted &&
        result.spawnErrorCode === undefined
      );
    } catch {
      return false;
    }
  }

  /**
   * Current whisper.cpp releases accept `-oj/--output-json`, `-of/--output-file`,
   * `-nt/--no-timestamps` and `-np/--no-prints`. Older builds reject some of
   * them, so a usage error triggers one retry with the minimal stable flags.
   */
  private async runWhisper(
    modelPath: string,
    wavPath: string,
    outputBase: string,
    options: TranscriptionOptions,
  ): Promise<CommandResult> {
    const full = await this.runner({
      command: this.binPath,
      args: [
        '-m',
        modelPath,
        '-f',
        wavPath,
        '-l',
        'pt',
        '-oj',
        '-of',
        outputBase,
        '-nt',
        '-np',
      ],
      timeoutMs: this.timeoutMs,
      signal: options.signal,
    });
    if (!shouldRetryWithMinimalFlags(full)) {
      return full;
    }
    return this.runner({
      command: this.binPath,
      args: [
        '-m',
        modelPath,
        '-f',
        wavPath,
        '-l',
        'pt',
        '-oj',
        '-of',
        outputBase,
      ],
      timeoutMs: this.timeoutMs,
      signal: options.signal,
    });
  }

  private async readOutputJson(
    outputBase: string,
    result: CommandResult,
  ): Promise<string> {
    const jsonPath = `${outputBase}.json`;
    try {
      return await fs.readFile(jsonPath, 'utf8');
    } catch {
      // Some builds print JSON to stdout instead of a file.
      const stdout = result.stdout.trim();
      if (stdout.startsWith('{')) {
        return stdout;
      }
      throw new TranscriptionError(
        'TRANSCRIPTION_OUTPUT_MISSING',
        'whisper.cpp não produziu saída JSON (verifique a versão/flags do binário).',
      );
    }
  }
}

const shouldRetryWithMinimalFlags = (result: CommandResult): boolean => {
  if (
    result.timedOut ||
    result.aborted ||
    result.spawnErrorCode !== undefined ||
    result.code === 0
  ) {
    return false;
  }
  return /unknown|unrecognized|invalid|usage|argument|help/i.test(
    `${result.stderr}\n${result.stdout}`,
  );
};

const summarizeCommandOutput = (result: CommandResult): string => {
  const raw = (result.stderr.trim() || result.stdout.trim()).slice(0, 400);
  return raw.length > 0 ? redactSecrets(raw) : 'sem saída';
};

// ===== Gemini audio adapter (opt-in cloud fallback) =====
export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com';
export const DEFAULT_GEMINI_TRANSCRIBE_MODEL = 'gemini-3.6-flash';
export const DEFAULT_GEMINI_TIMEOUT_MS = 45_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type GeminiAudioAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
};

const GEMINI_RESPONSE_SCHEMA = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(z.object({ text: z.string().optional() }))
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const GEMINI_TRANSCRIPT_SCHEMA = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  segments: z
    .array(
      z.object({
        text: z.string(),
        startMs: z.number().min(0),
        endMs: z.number().min(0),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
});

/**
 * Prompt for the cloud fallback. It forbids summarisation/guesswork and pins
 * the JSON contract so the response can be validated instead of trusted.
 */
export function buildGeminiTranscriptionPrompt(
  options: TranscriptionOptions,
): string {
  return [
    'Você transcreve áudio de debates em português do Brasil.',
    'Transcreva integralmente, palavra por palavra, de forma literal (verbatim).',
    'Não resuma, não reinterprete, não corrija gramática e não invente conteúdo.',
    'Preserve números, unidades monetárias e negações exatamente como falados.',
    'Se um trecho for inaudível, escreva [inaudível] no ponto exato; nunca preencha por suposição.',
    'Os tempos startMs/endMs são inteiros em milissegundos, relativos ao início deste áudio.',
    'Responda SOMENTE com JSON válido, sem markdown e sem comentários, no formato:',
    '{"text":"transcrição completa","confidence":0.0,"segments":[{"text":"trecho","startMs":0,"endMs":1000,"confidence":0.0}]}',
    `Duração do áudio: ${String(options.durationMs)} ms.`,
  ].join('\n');
}

const stripCodeFences = (value: string): string =>
  value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

/**
 * Opt-in Gemini audio fallback (REST `generateContent` with inline WAV).
 *
 * Never constructed by default: `createTranscriptionProvider` only builds it
 * when `ALLOW_CLOUD_TRANSCRIPTION === 'true'` and a Google key is present, or
 * when the caller instantiates it explicitly. The key travels in the
 * `x-goog-api-key` header (not the URL) and is never logged.
 */
export class GeminiAudioAdapter implements TranscriptionProvider {
  readonly name = 'gemini-audio';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiAudioAdapterOptions) {
    const env = options.env ?? process.env;
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new TranscriptionUnavailableError(
        'Fallback Gemini requer uma chave Google (apiKeys.google).',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (
      trimToUndefined(options.baseUrl) ??
      trimToUndefined(env['GEMINI_BASE_URL']) ??
      DEFAULT_GEMINI_BASE_URL
    ).replace(/\/+$/, '');
    this.model =
      trimToUndefined(options.model) ??
      trimToUndefined(env['GEMINI_TRANSCRIBE_MODEL']) ??
      DEFAULT_GEMINI_TRANSCRIBE_MODEL;
    this.timeoutMs =
      options.timeoutMs ??
      readPositiveInt(env['GEMINI_TIMEOUT_MS'], DEFAULT_GEMINI_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.apiKey.length > 0);
  }

  async transcribe(
    pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    throwIfAborted(options.signal);
    if (pcm.length === 0) {
      return { text: '', segments: [] };
    }

    const wav = pcm16ToWav(pcm, options.sampleRate, 1);
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
      const response = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: buildGeminiTranscriptionPrompt(options) },
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: wav.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new TranscriptionError(
          'TRANSCRIPTION_HTTP_ERROR',
          `Gemini retornou HTTP ${String(response.status)} para transcrição; verifique a chave e a cota.`,
        );
      }

      const payload = (await response.json()) as unknown;
      return parseGeminiTranscriptionResponse(payload);
    } catch (error) {
      if (isAbortError(error)) {
        throw timeoutState.fired
          ? new TranscriptionTimeoutError(this.timeoutMs)
          : new TranscriptionAbortedError();
      }
      if (error instanceof TranscriptionError) {
        throw error;
      }
      throw new TranscriptionFailedError(
        `Falha na chamada ao Gemini: ${error instanceof Error ? redactSecrets(error.message) : 'erro desconhecido'}`,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private endpoint(): string {
    return `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
  }
}

/** Pure parser/validator for the Gemini `generateContent` response. */
export function parseGeminiTranscriptionResponse(
  payload: unknown,
): TranscriptionResult {
  const response = GEMINI_RESPONSE_SCHEMA.safeParse(payload);
  if (!response.success) {
    throw new TranscriptionParseError(
      'Resposta do Gemini em formato inesperado',
    );
  }
  const parts = response.data.candidates?.[0]?.content?.parts ?? [];
  const rawText = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (rawText.length === 0) {
    throw new TranscriptionParseError('Resposta do Gemini sem conteúdo');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(stripCodeFences(rawText)) as unknown;
  } catch {
    throw new TranscriptionParseError(
      'Resposta do Gemini não contém JSON válido',
    );
  }

  const parsed = GEMINI_TRANSCRIPT_SCHEMA.safeParse(decoded);
  if (!parsed.success) {
    throw new TranscriptionParseError(
      'JSON do Gemini não segue o contrato de transcrição',
    );
  }

  const segments: TranscribedSegment[] = [];
  for (const segment of parsed.data.segments ?? []) {
    const text = segment.text.trim();
    if (text.length === 0) {
      continue;
    }
    const startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.max(startMs, Math.round(segment.endMs));
    segments.push(
      segment.confidence === undefined
        ? { text, startMs, endMs }
        : { text, startMs, endMs, confidence: segment.confidence },
    );
  }

  const text =
    parsed.data.text.trim().length > 0
      ? parsed.data.text.trim()
      : segments
          .map((segment) => segment.text)
          .join(' ')
          .trim();
  const confidence =
    parsed.data.confidence ??
    averageDefined(
      segments
        .map((segment) => segment.confidence)
        .filter((value): value is number => value !== undefined),
    );

  return confidence === undefined
    ? { text, segments }
    : { text, segments, confidence };
}

// ===== Unavailable provider =====
export const DEFAULT_UNAVAILABLE_TRANSCRIPTION_MESSAGE =
  'Transcrição indisponível: whisper.cpp não foi encontrado (defina WHISPER_CPP_BIN e WHISPER_CPP_MODEL) e o fallback de nuvem está desabilitado. ' +
  'Qualifique o whisper.cpp conforme LIVE-000 ou defina ALLOW_CLOUD_TRANSCRIPTION=true com uma chave Google para autorizar o envio de áudio ao Gemini.';

/**
 * Explicit failure instead of silent degradation: `transcribe()` rejects with
 * an actionable {@link TranscriptionUnavailableError}.
 */
export class UnavailableTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'unavailable';

  /** Actionable, secret-free explanation (shown to the user at START). */
  readonly reason: string;

  constructor(reason = DEFAULT_UNAVAILABLE_TRANSCRIPTION_MESSAGE) {
    this.reason = reason;
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  transcribe(): Promise<TranscriptionResult> {
    return Promise.reject(new TranscriptionUnavailableError(this.reason));
  }
}

// ===== Factory =====
export type TranscriptionProviderPreference =
  | 'auto'
  | 'whisper'
  | 'gemini'
  | 'unavailable';

export type CreateTranscriptionProviderOptions = {
  googleApiKey?: string;
  preferred?: TranscriptionProviderPreference;
  env?: NodeJS.ProcessEnv;
  /** Injection points for tests/DI; default to the real adapters. */
  createWhisperProvider?: () => TranscriptionProvider;
  createGeminiProvider?: (apiKey: string) => TranscriptionProvider;
};

const isCloudTranscriptionAllowed = (env: NodeJS.ProcessEnv): boolean =>
  env['ALLOW_CLOUD_TRANSCRIPTION'] === 'true';

/** `TRANSCRIPTION_PROVIDER` selects a preference; unknown values mean `auto`. */
const preferredFromEnv = (
  env: NodeJS.ProcessEnv,
): TranscriptionProviderPreference => {
  const raw = env['TRANSCRIPTION_PROVIDER']?.trim().toLowerCase();
  return raw === 'whisper' || raw === 'gemini' || raw === 'unavailable'
    ? raw
    : 'auto';
};

const unavailableFor = (
  preferred: TranscriptionProviderPreference,
  hasGoogleKey: boolean,
  allowCloud: boolean,
): UnavailableTranscriptionProvider => {
  if (preferred === 'gemini' && !allowCloud) {
    return new UnavailableTranscriptionProvider(
      'Fallback Gemini solicitado, mas ALLOW_CLOUD_TRANSCRIPTION não é "true": o áudio não será enviado à nuvem. ' +
        DEFAULT_UNAVAILABLE_TRANSCRIPTION_MESSAGE,
    );
  }
  if (preferred === 'gemini' && !hasGoogleKey) {
    return new UnavailableTranscriptionProvider(
      'Fallback Gemini solicitado sem chave Google (apiKeys.google): o áudio não será enviado à nuvem. ' +
        DEFAULT_UNAVAILABLE_TRANSCRIPTION_MESSAGE,
    );
  }
  return new UnavailableTranscriptionProvider(
    DEFAULT_UNAVAILABLE_TRANSCRIPTION_MESSAGE,
  );
};

/**
 * Resolves the transcription provider:
 *
 * 1. whisper.cpp when it probes available;
 * 2. Gemini **only** when `ALLOW_CLOUD_TRANSCRIPTION === 'true'` and a Google
 *    key was supplied;
 * 3. an explicit unavailable provider otherwise.
 *
 * Audio never reaches the cloud without both the flag and the key.
 */
export async function createTranscriptionProvider(
  options: CreateTranscriptionProviderOptions = {},
): Promise<TranscriptionProvider> {
  const env = options.env ?? process.env;
  const preferred = options.preferred ?? preferredFromEnv(env);
  const googleApiKey = options.googleApiKey?.trim() ?? '';
  const allowCloud = isCloudTranscriptionAllowed(env);
  const createWhisper =
    options.createWhisperProvider ?? (() => new WhisperCppAdapter({ env }));
  const createGemini =
    options.createGeminiProvider ??
    ((apiKey: string) => new GeminiAudioAdapter({ apiKey, env }));

  if (preferred === 'unavailable') {
    return unavailableFor(preferred, googleApiKey.length > 0, allowCloud);
  }

  if (preferred === 'gemini') {
    if (!allowCloud || googleApiKey.length === 0) {
      return unavailableFor(preferred, googleApiKey.length > 0, allowCloud);
    }
    return createGemini(googleApiKey);
  }

  const whisper = createWhisper();
  if (await whisper.isAvailable()) {
    return whisper;
  }

  if (preferred === 'whisper') {
    return unavailableFor(preferred, googleApiKey.length > 0, allowCloud);
  }

  if (allowCloud && googleApiKey.length > 0) {
    return createGemini(googleApiKey);
  }

  return unavailableFor(preferred, googleApiKey.length > 0, allowCloud);
}
