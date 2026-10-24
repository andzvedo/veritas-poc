/**
 * Test harness that drives LivePipeline directly (no Socket.IO): scripted
 * transcription per window, scripted diarization labels so segments finalize
 * on speaker changes, and injectable extraction/investigation mocks.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AudioChunkMeta, Claim, Verification } from '@veritas/shared';
import { LivePipeline, type LivePipelineDeps, type LivePipelineEmit } from '#/live/livePipeline.js';
import type { DiarizationProvider } from '#/live/speakerIdentification.js';
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from '#/live/transcription.js';
import type { ResearchProvider } from '#/research/types.js';

export const SESSION_ID = 'live-harness-1';
export const CHUNK_SAMPLES = 16_000;
export const FIXED_NOW = new Date('2026-10-23T12:00:00.000Z');

export type Emitted = { event: string; payload: Record<string, unknown> };

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export const flush = async (times = 10): Promise<void> => {
  for (let index = 0; index < times; index++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
};

export const makePcm = (samples = CHUNK_SAMPLES): Buffer => {
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    pcm.writeInt16LE((index % 2 === 0 ? 1 : -1) * 12_000, index * 2);
  }
  return pcm;
};

export const chunkMeta = (chunkSeq: number): AudioChunkMeta => ({
  chunkSeq,
  encoding: 'pcm16le',
  sampleRate: 16000,
  channels: 1,
  samples: CHUNK_SAMPLES,
  startSample: chunkSeq * CHUNK_SAMPLES,
  capturedAt: FIXED_NOW.toISOString(),
});

/** One utterance per 1 s window, in order. */
export class ScriptedTranscription implements TranscriptionProvider {
  readonly name = 'scripted-transcription';
  constructor(private readonly lines: string[]) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  transcribe(
    _pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    const index = Math.round(options.startSample / CHUNK_SAMPLES);
    const text = this.lines.at(index) ?? '';
    return Promise.resolve({
      text,
      confidence: 0.95,
      segments:
        text.length === 0
          ? []
          : [{ text, startMs: 0, endMs: options.durationMs, confidence: 0.95 }],
    });
  }
}

/** Speaker label per 1 s window, in order. */
export const scriptedDiarization = (labels: string[]): DiarizationProvider => ({
  name: 'scripted-diarization',
  isAvailable: () => Promise.resolve(true),
  identify: (_pcm, options) => {
    const index = Math.round(options.startMs / 1000);
    const label = labels.at(index) ?? labels.at(-1) ?? 'SPEAKER_00';
    return Promise.resolve([{ speakerLabel: label, confidence: 0.95 }]);
  },
});

export const makeClaim = (args: {
  id: string;
  text: string;
  segmentIds: string[];
  speakerId?: string;
  sessionId?: string;
}): Claim => {
  const now = FIXED_NOW.toISOString();
  return {
    id: args.id,
    sessionId: args.sessionId ?? SESSION_ID,
    segmentIds: [...args.segmentIds],
    ...(args.speakerId === undefined ? {} : { speakerId: args.speakerId }),
    originalQuote: args.text,
    normalizedClaim: args.text,
    status: 'DETECTED',
    notFactCheckable: false,
    atomicClaims: [{ id: `${args.id}-atomic-0`, proposition: args.text }],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
};

export const makeVerification = (
  claim: Claim,
  overrides: Partial<Verification> = {},
): Verification => {
  const now = FIXED_NOW.toISOString();
  return {
    id: `verification-${claim.id}-0`,
    sessionId: claim.sessionId,
    claimId: claim.id,
    segmentIds: [...claim.segmentIds],
    originalQuote: claim.originalQuote,
    normalizedClaim: claim.normalizedClaim,
    transcriptConfirmed: true,
    atomicClaim: { id: `${claim.id}-atomic-0`, proposition: claim.normalizedClaim },
    status: 'COMPLETED',
    verdict: 'SUPPORTED',
    conclusion: `Conclusão para: ${claim.normalizedClaim}`,
    mechanisms: [],
    supportedAspects: [],
    limitations: [],
    evidence: [
      {
        id: `ev-${claim.id}`,
        sourceId: `src-${claim.id}`,
        relation: 'SUPPORTS',
        claimIds: [claim.id],
        excerpt: 'Trecho do documento oficial.',
        explanation: 'O documento confirma a afirmação.',
        verifiedContent: true,
      },
    ],
    sources: [
      {
        id: `src-${claim.id}`,
        title: 'Banco Central — Pix',
        publisher: 'Banco Central do Brasil',
        url: 'https://www.bcb.gov.br/estabilidadefinanceira/pix',
        type: 'PRIMARY',
        accessedAt: now,
      },
    ],
    revision: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

export const dummyLlm = {} as BaseChatModel;
export const dummyResearch = {
  name: 'dummy-research',
} as unknown as ResearchProvider;

export type Harness = {
  pipeline: LivePipeline;
  events: Emitted[];
  of: (event: string) => Record<string, unknown>[];
  sendWindows: (count: number, fromSeq?: number) => Promise<void>;
};

export const createHarness = (
  options: {
    lines: string[];
    labels?: string[];
    extractClaimsFn?: LivePipelineDeps['extractClaimsFn'];
    investigateClaimFn?: LivePipelineDeps['investigateClaimFn'];
    apiKeys?: LivePipelineDeps['apiKeys'];
    claimQueueOptions?: LivePipelineDeps['claimQueueOptions'];
    withLlms?: boolean;
    sessionId?: string;
    ownerSocketId?: string;
  },
): Harness => {
  const events: Emitted[] = [];
  const record = (event: string) => (payload: unknown) => {
    events.push({ event, payload: payload as Record<string, unknown> });
  };
  const emit: LivePipelineEmit = {
    LIVE_SESSION_STARTED: record('LIVE_SESSION_STARTED'),
    LIVE_SESSION_STATE: record('LIVE_SESSION_STATE'),
    TRANSCRIPT_PARTIAL: record('TRANSCRIPT_PARTIAL'),
    TRANSCRIPT_FINAL: record('TRANSCRIPT_FINAL'),
    TRANSCRIPT_REVISED: record('TRANSCRIPT_REVISED'),
    SPEAKER_MAPPING_UPDATED: record('SPEAKER_MAPPING_UPDATED'),
    CLAIM_DETECTED: record('CLAIM_DETECTED'),
    CLAIM_STATUS_UPDATED: record('CLAIM_STATUS_UPDATED'),
    VERIFICATION_RESULT: record('VERIFICATION_RESULT'),
    VERIFICATION_INVALIDATED: record('VERIFICATION_INVALIDATED'),
    SESSION_SNAPSHOT: record('SESSION_SNAPSHOT'),
    LIVE_METRICS: record('LIVE_METRICS'),
    LIVE_GAP: record('LIVE_GAP'),
    LIVE_SESSION_ENDED: record('LIVE_SESSION_ENDED'),
    AUDIO_CHUNK_ACK: record('AUDIO_CHUNK_ACK'),
    SESSION_EXPORT: record('SESSION_EXPORT'),
    HUMAN_REVIEW_RECORDED: record('HUMAN_REVIEW_RECORDED'),
  };
  const withLlms = options.withLlms ?? true;
  const pipeline = new LivePipeline({
    sessionId: options.sessionId ?? SESSION_ID,
    ownerSocketId: options.ownerSocketId ?? 'socket-owner',
    source: 'TAB',
    language: 'pt-BR',
    transcription: new ScriptedTranscription(options.lines),
    diarization: scriptedDiarization(
      options.labels ??
        options.lines.map((_, index) => `SPEAKER_0${String(index % 2)}`),
    ),
    emit,
    ...(withLlms
      ? {
          extractionLlm: dummyLlm,
          evaluationLlm: dummyLlm,
          researchProvider: dummyResearch,
        }
      : {}),
    ...(options.apiKeys === undefined ? {} : { apiKeys: options.apiKeys }),
    sessionConfig: {
      windowMs: 1000,
      overlapMs: 0,
      endDrainMs: 50,
      maxBufferBytes: CHUNK_SAMPLES * 2 * 4,
      maxPendingWindows: 8,
    },
    ...(options.extractClaimsFn === undefined
      ? {}
      : { extractClaimsFn: options.extractClaimsFn }),
    ...(options.investigateClaimFn === undefined
      ? {}
      : { investigateClaimFn: options.investigateClaimFn }),
    claimQueueOptions: {
      concurrency: 2,
      capacity: 10,
      timeoutMs: 5_000,
      maxRetries: 0,
      retryDelayMs: 0,
      ...(options.claimQueueOptions ?? {}),
    },
  });

  const sendWindows = async (count: number, fromSeq = 0): Promise<void> => {
    for (let seq = fromSeq; seq < fromSeq + count; seq++) {
      pipeline.handleAudioChunk(chunkMeta(seq), makePcm());
      await flush();
    }
    await flush();
  };

  return {
    pipeline,
    events,
    of: (event) =>
      events.filter((item) => item.event === event).map((item) => item.payload),
    sendWindows,
  };
};

/** Extraction mock: one claim per segment, id derived from the segment id. */
export const claimPerSegment = (
  prefix = 'claim',
): NonNullable<LivePipelineDeps['extractClaimsFn']> =>
  ((args: {
    text: string;
    source: { sessionId?: string; segmentIds: string[]; speakerId?: string };
  }) =>
    Promise.resolve([
      makeClaim({
        id: `${prefix}-${args.source.segmentIds.join('_')}`,
        text: args.text,
        segmentIds: args.source.segmentIds,
        ...(args.source.speakerId === undefined
          ? {}
          : { speakerId: args.source.speakerId }),
      }),
    ])) as unknown as NonNullable<LivePipelineDeps['extractClaimsFn']>;
