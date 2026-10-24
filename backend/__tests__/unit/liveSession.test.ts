import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioChunkMeta, TranscriptSegment } from '@veritas/shared';
import {
  LiveSession,
  LiveSessionCursorError,
  LiveSessionError,
  LiveSessionStateError,
  LiveSessionUnavailableError,
  liveSessionConfigFromEnv,
  type AudioChunkAck,
  type LiveGap,
  type LiveMetric,
  type LiveSessionConfig,
  type LiveSessionSnapshot,
  type LiveTranscriptEvent,
} from '#/live/liveSession.js';
import { SpeechSegmenter } from '#/live/speechSegments.js';
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from '#/live/transcription.js';
import {
  SpeakerRegistry,
  type DiarizationProvider,
  type SpeakerObservation,
} from '#/live/speakerIdentification.js';
import { msToSamples } from '#/live/wav.js';

const SESSION_ID = 'session-1';
const CHUNK_SAMPLES = 16000; // 1 s at 16 kHz

type ChunkOptions = { samples?: number; silent?: boolean };

const makeChunk = (
  chunkSeq: number,
  startSample: number,
  options: ChunkOptions = {},
): { meta: AudioChunkMeta; pcm: Buffer } => {
  const samples = options.samples ?? CHUNK_SAMPLES;
  const pcm = Buffer.alloc(samples * 2);
  if (options.silent !== true) {
    for (let index = 0; index < samples; index++) {
      pcm.writeInt16LE((index % 2 === 0 ? 1 : -1) * 10_000, index * 2);
    }
  }
  return {
    meta: {
      chunkSeq,
      encoding: 'pcm16le',
      sampleRate: 16000,
      channels: 1,
      samples,
      startSample,
      capturedAt: '2025-01-10T12:00:00.000Z',
    },
    pcm,
  };
};

class ScriptedTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'fake-transcription';
  readonly calls: {
    startSample: number;
    durationMs: number;
    signal?: AbortSignal;
  }[] = [];
  handler: (options: TranscriptionOptions) => Promise<TranscriptionResult>;

  constructor(
    handler: (
      options: TranscriptionOptions,
    ) => Promise<TranscriptionResult> = () =>
      Promise.resolve({ text: 'fala de teste', confidence: 0.9 }),
  ) {
    this.handler = handler;
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  transcribe(
    _pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    this.calls.push({
      startSample: options.startSample,
      durationMs: options.durationMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return this.handler(options);
  }
}

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushAsync = async (): Promise<void> => {
  for (let index = 0; index < 30; index++) {
    await Promise.resolve();
  }
};

type Harness = {
  session: LiveSession;
  provider: ScriptedTranscriptionProvider;
  segmenter: SpeechSegmenter;
  states: string[];
  gaps: LiveGap[];
  transcripts: LiveTranscriptEvent[];
  finals: TranscriptSegment[];
  metrics: LiveMetric[];
  acks: AudioChunkAck[];
};

const createHarness = (
  options: {
    transcription?: TranscriptionProvider;
    config?: Partial<LiveSessionConfig>;
    diarization?: DiarizationProvider;
    speakerRegistry?: SpeakerRegistry;
  } = {},
): Harness => {
  const provider =
    options.transcription instanceof ScriptedTranscriptionProvider
      ? options.transcription
      : new ScriptedTranscriptionProvider();
  const transcription = options.transcription ?? provider;
  const segmenter = new SpeechSegmenter({
    sessionId: SESSION_ID,
    clock: () => new Date('2025-01-10T12:00:00.000Z'),
  });
  const states: string[] = [];
  const gaps: LiveGap[] = [];
  const transcripts: LiveTranscriptEvent[] = [];
  const finals: TranscriptSegment[] = [];
  const metrics: LiveMetric[] = [];
  const acks: AudioChunkAck[] = [];

  const session = new LiveSession({
    sessionId: SESSION_ID,
    transcription,
    segmenter,
    ...(options.diarization === undefined
      ? {}
      : { diarization: options.diarization }),
    ...(options.speakerRegistry === undefined
      ? {}
      : { speakerRegistry: options.speakerRegistry }),
    config: {
      windowMs: 2000,
      overlapMs: 500,
      endDrainMs: 1000,
      maxBufferBytes: 128_000,
      maxPendingWindows: 4,
      ...options.config,
    },
    onState: (event) => {
      states.push(event.state);
    },
    onGap: (gap) => {
      gaps.push(gap);
    },
    onTranscript: (event) => {
      transcripts.push(event);
    },
    onSegmentFinal: (segment) => {
      finals.push(segment);
    },
    onMetrics: (metric) => {
      metrics.push(metric);
    },
    onAck: (ack) => {
      acks.push(ack);
    },
  });

  return {
    session,
    provider,
    segmenter,
    states,
    gaps,
    transcripts,
    finals,
    metrics,
    acks,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveSession state machine', () => {
  it('walks IDLE → CONNECTING → LISTENING ⇄ PAUSED → ENDING → ENDED', async () => {
    const harness = createHarness();
    const { session, states } = harness;

    expect(session.getState()).toBe('IDLE');
    expect(() => {
      session.pause();
    }).toThrow(LiveSessionStateError);

    session.start();
    expect(states).toEqual(['CONNECTING', 'LISTENING']);
    expect(() => {
      session.start();
    }).toThrow(LiveSessionStateError);

    session.pause();
    expect(session.getState()).toBe('PAUSED');
    session.resume();
    expect(session.getState()).toBe('LISTENING');

    await session.end('user');
    expect(session.getState()).toBe('ENDED');
    expect(states.slice(-2)).toEqual(['ENDING', 'ENDED']);
  });

  it('rejects controls that do not apply to the current state', () => {
    const { session } = createHarness();
    expect(() => {
      session.resume();
    }).toThrow(LiveSessionStateError);
    expect(() => {
      session.markReconnecting();
    }).toThrow(LiveSessionStateError);

    session.start();
    expect(() => {
      session.recover();
    }).toThrow(LiveSessionStateError);
    session.cancel();
    expect(session.getState()).toBe('ENDED');
    expect(() => {
      session.cancel();
    }).not.toThrow();
  });

  it('reports recoverable ERROR and allows recovery', async () => {
    const provider = new ScriptedTranscriptionProvider(() =>
      Promise.reject(new Error('whisper crashed')),
    );
    const { session, states } = createHarness({ transcription: provider });
    session.start();
    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    expect(session.handleAudioChunk(first.meta, first.pcm).accepted).toBe(true);
    expect(session.handleAudioChunk(second.meta, second.pcm).accepted).toBe(
      true,
    );

    await flushAsync();

    expect(session.getState()).toBe('ERROR');
    expect(states).toContain('ERROR');
    expect(() => {
      session.recover();
    }).not.toThrow();
    expect(session.getState()).toBe('LISTENING');
  });

  it('never promises a durable restart', () => {
    expect(() => LiveSession.restoreFromPersistedState()).toThrow(
      LiveSessionUnavailableError,
    );
  });
});

describe('LiveSession chunk handling', () => {
  it('acknowledges chunks and rejects duplicates', async () => {
    const { session, acks } = createHarness();
    session.start();
    const chunk = makeChunk(0, 0);

    const first = session.handleAudioChunk(chunk.meta, chunk.pcm);
    const duplicate = session.handleAudioChunk(chunk.meta, chunk.pcm);

    expect(first).toMatchObject({
      sessionId: SESSION_ID,
      chunkSeq: 0,
      accepted: true,
      state: 'LISTENING',
    });
    expect(duplicate).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(acks).toHaveLength(2);
    expect(acks[1]?.accepted).toBe(false);
    await flushAsync();
  });

  it('rejects malformed chunks and size mismatches', () => {
    const { session } = createHarness();
    session.start();
    const chunk = makeChunk(0, 0);

    const badMeta = session.handleAudioChunk(
      { ...chunk.meta, encoding: 'mp3' } as unknown as AudioChunkMeta,
      chunk.pcm,
    );
    expect(badMeta).toMatchObject({ accepted: false, reason: 'invalid' });

    const badSize = session.handleAudioChunk(
      chunk.meta,
      Buffer.alloc(chunk.pcm.length + 2),
    );
    expect(badSize).toMatchObject({ accepted: false, reason: 'invalid' });
  });

  it('emits an explicit gap when chunk sequences skip samples', async () => {
    const { session, gaps } = createHarness();
    session.start();
    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);

    // Chunk 2 is lost; capture resumes at sample 48000 (1.5 s hole).
    const third = makeChunk(3, 48000);
    const ack = session.handleAudioChunk(third.meta, third.pcm);

    expect(ack.accepted).toBe(true);
    expect(ack.gap).toMatchObject({
      fromSample: 32000,
      toSample: 48000,
      reason: 'missing_chunks',
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.reason).toBe('missing_chunks');
    await flushAsync();
  });

  it('skips silent windows without calling the provider', async () => {
    const { session, provider, metrics } = createHarness();
    session.start();
    const first = makeChunk(0, 0, { silent: true });
    const second = makeChunk(1, 16000, { silent: true });
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);

    await flushAsync();

    expect(provider.calls).toHaveLength(0);
    expect(metrics.some((metric) => metric.stage === 'vad')).toBe(true);
    await session.end();
  });

  it('transcribes windows and emits provisional/final segments with media time', async () => {
    const provider = new ScriptedTranscriptionProvider(() =>
      Promise.resolve({
        text: 'o pix foi criado em 2015',
        confidence: 0.9,
      }),
    );
    const harness = createHarness({ transcription: provider });
    const { session } = harness;
    session.start();
    const first = makeChunk(0, 0);
    session.handleAudioChunk(first.meta, first.pcm);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(second.meta, second.pcm);

    await flushAsync();

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      startSample: 0,
      durationMs: 2000,
    });
    expect(harness.transcripts.length).toBeGreaterThan(0);
    expect(harness.transcripts[0]?.kind).toBe('provisional');
    expect(harness.transcripts[0]?.segment.text).toBe(
      'o pix foi criado em 2015',
    );
    expect(
      harness.metrics.some((metric) => metric.stage === 'transcription'),
    ).toBe(true);
    expect(
      harness.metrics.some((metric) => metric.stage === 'segmentation'),
    ).toBe(true);

    await session.end('user');

    expect(harness.finals).toHaveLength(1);
    expect(harness.finals[0]?.status).toBe('FINAL');
    expect(harness.finals[0]?.startMs).toBe(0);
    expect(harness.finals[0]?.endMs).toBe(2000);
    expect(harness.transcripts.at(-1)?.kind).toBe('final');
  });

  it('does not call onSegmentFinal for BLOCKED segments', async () => {
    const provider = new ScriptedTranscriptionProvider(() =>
      Promise.resolve({ text: 'o valor é 600 reais', confidence: 0.3 }),
    );
    const harness = createHarness({ transcription: provider });
    const { session } = harness;
    session.start();
    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);

    await flushAsync();
    await session.end('user');

    expect(harness.finals).toHaveLength(0);
    const finalEvent = harness.transcripts.find(
      (event) => event.kind === 'final',
    );
    expect(finalEvent?.segment.status).toBe('BLOCKED');
    expect(finalEvent?.segment.uncertaintyReasons).toContain('NUMBER');
  });
});

describe('LiveSession pause/resume and gaps', () => {
  it('stops accepting chunks while paused and reports the pause hole', async () => {
    const { session, gaps } = createHarness();
    session.start();
    const first = makeChunk(0, 0);
    session.handleAudioChunk(first.meta, first.pcm);

    session.pause();
    expect(session.getState()).toBe('PAUSED');

    const whilePaused = makeChunk(1, 16000);
    const rejected = session.handleAudioChunk(
      whilePaused.meta,
      whilePaused.pcm,
    );
    expect(rejected).toMatchObject({ accepted: false, reason: 'paused' });

    session.resume();
    expect(session.getState()).toBe('LISTENING');

    // Capture resumes 1 s later: the media clock never compacts silently.
    const resumed = makeChunk(2, 32000);
    const ack = session.handleAudioChunk(resumed.meta, resumed.pcm);
    expect(ack.accepted).toBe(true);
    expect(ack.gap).toMatchObject({ fromSample: 16000, toSample: 32000 });
    expect(ack.gap?.reason).toBe('paused');
    expect(gaps).toHaveLength(1);
    await session.end();
  });

  it('marks reconnection explicitly and requires permission to resume capture', async () => {
    const { session } = createHarness();
    session.start();
    session.markReconnecting('socket_closed');
    expect(session.getState()).toBe('RECONNECTING');

    const chunk = makeChunk(0, 0);
    const rejected = session.handleAudioChunk(chunk.meta, chunk.pcm);
    expect(rejected).toMatchObject({
      accepted: false,
      reason: 'not_listening',
    });

    const snapshot = session.resumeFromCursor(0);
    expect(snapshot.state).toBe('PAUSED');
    expect(() => {
      session.resume();
    }).not.toThrow();
    expect(session.getState()).toBe('LISTENING');
    await session.end();
  });
});

describe('LiveSession end/cancel', () => {
  it('finalizes the last window and drains accepted work on end', async () => {
    const { session, finals, states } = createHarness();
    session.start();
    const first = makeChunk(0, 0);
    session.handleAudioChunk(first.meta, first.pcm); // 1 s, below window size

    const endPromise = session.end('user');
    expect(session.getState()).toBe('ENDING');
    await endPromise;

    expect(session.getState()).toBe('ENDED');
    expect(states).toContain('ENDING');
    expect(finals).toHaveLength(1);
    expect(finals[0]?.endMs).toBe(1000);
  });

  it('bounds the drain by LIVE_END_DRAIN_MS and reports a gap', async () => {
    vi.useFakeTimers();
    const pending = deferred<TranscriptionResult>();
    const provider = new ScriptedTranscriptionProvider(() => pending.promise);
    const harness = createHarness({ transcription: provider });
    const { session } = harness;
    session.start();
    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);

    await vi.advanceTimersByTimeAsync(0);
    expect(provider.calls).toHaveLength(1);

    const endPromise = session.end('user');
    expect(session.getState()).toBe('ENDING');
    await vi.advanceTimersByTimeAsync(1500);
    await endPromise;

    expect(session.getState()).toBe('ENDED');
    expect(harness.gaps.some((gap) => gap.reason === 'end_drain_timeout')).toBe(
      true,
    );
    expect(provider.calls[0]?.signal?.aborted).toBe(true);
  });

  it('cancels immediately, aborts in-flight work and discards buffers', async () => {
    const provider = new ScriptedTranscriptionProvider(
      (options) =>
        new Promise<TranscriptionResult>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const harness = createHarness({ transcription: provider });
    const { session } = harness;
    session.start();
    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);

    await flushAsync();
    expect(provider.calls).toHaveLength(1);

    session.cancel('user_cancel');

    expect(session.getState()).toBe('ENDED');
    expect(provider.calls[0]?.signal?.aborted).toBe(true);
    expect(harness.gaps.some((gap) => gap.reason === 'user_cancel')).toBe(true);

    await flushAsync();
    expect(session.getSnapshot().bufferedSamples).toBe(0);
  });
});

describe('LiveSession draining and loss visibility', () => {
  it('drains work queued while paused instead of timing out', async () => {
    vi.useFakeTimers();
    const firstWindow = deferred<TranscriptionResult>();
    let calls = 0;
    const provider = new ScriptedTranscriptionProvider(() => {
      calls += 1;
      if (calls === 1) {
        return firstWindow.promise;
      }
      return Promise.resolve({ text: 'segunda janela', confidence: 0.9 });
    });
    const harness = createHarness({ transcription: provider });
    const { session } = harness;
    session.start();

    for (let index = 0; index < 4; index++) {
      const chunk = makeChunk(index, index * CHUNK_SAMPLES);
      session.handleAudioChunk(chunk.meta, chunk.pcm);
    }
    await vi.advanceTimersByTimeAsync(0);
    session.pause();
    const endPromise = session.end('user');
    expect(session.getState()).toBe('ENDING');

    firstWindow.resolve({ text: 'primeira janela', confidence: 0.9 });
    await vi.advanceTimersByTimeAsync(0);
    await endPromise;

    expect(session.getState()).toBe('ENDED');
    expect(harness.gaps.some((gap) => gap.reason === 'end_drain_timeout')).toBe(
      false,
    );
    expect(harness.finals.length).toBeGreaterThan(0);
  });

  it('flags an empty transcription on the open segment as TRANSCRIPTION_ERROR', async () => {
    let calls = 0;
    const provider = new ScriptedTranscriptionProvider(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? { text: 'primeiro trecho transcrito', confidence: 0.9 }
          : { text: '', confidence: 0.9 },
      );
    });
    const harness = createHarness({ transcription: provider });
    const { session } = harness;
    session.start();
    for (let index = 0; index < 4; index++) {
      const chunk = makeChunk(index, index * CHUNK_SAMPLES);
      session.handleAudioChunk(chunk.meta, chunk.pcm);
    }
    await flushAsync();
    await session.end('user');

    const finalEvent = harness.transcripts.find(
      (event) => event.kind === 'final',
    );
    expect(finalEvent?.segment.status).toBe('BLOCKED');
    expect(finalEvent?.segment.uncertaintyReasons).toContain(
      'TRANSCRIPTION_ERROR',
    );
    expect(finalEvent?.segment.text).toBe('primeiro trecho transcrito');
  });

  it('attaches acoustic speaker ids without inventing names', async () => {
    const diarization: DiarizationProvider = {
      name: 'fake-diarization',
      isAvailable: () => Promise.resolve(true),
      identify: () =>
        Promise.resolve<SpeakerObservation[]>([
          { speakerLabel: 'SPEAKER_00', confidence: 0.9 },
        ]),
    };
    const speakerRegistry = new SpeakerRegistry();
    const provider = new ScriptedTranscriptionProvider(() =>
      Promise.resolve({ text: 'fala atribuída ao locutor', confidence: 0.9 }),
    );
    const harness = createHarness({
      transcription: provider,
      diarization,
      speakerRegistry,
    });
    const { session } = harness;
    session.start();
    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);
    await flushAsync();

    const provisional = harness.transcripts.at(-1);
    expect(provisional?.segment.speakerId).toBe('speaker-1');
    expect(speakerRegistry.getParticipantName('speaker-1')).toBeUndefined();
    expect(speakerRegistry.getMappings()).toEqual([]);
    await session.end('user');
  });

  it('aligns different transcript segments with their diarized turns', async () => {
    const diarization: DiarizationProvider = {
      name: 'fake-diarization',
      isAvailable: () => Promise.resolve(true),
      identify: () =>
        Promise.resolve<SpeakerObservation[]>([
          { speakerLabel: 'SPEAKER_A', startMs: 0, endMs: 1000 },
          { speakerLabel: 'SPEAKER_B', startMs: 1000, endMs: 2000 },
        ]),
    };
    const provider = new ScriptedTranscriptionProvider(() =>
      Promise.resolve({
        text: 'fala A fala B',
        segments: [
          { text: 'fala A', startMs: 100, endMs: 900 },
          { text: 'fala B', startMs: 1100, endMs: 1900 },
        ],
      }),
    );
    const harness = createHarness({
      transcription: provider,
      diarization,
      speakerRegistry: new SpeakerRegistry(),
    });
    harness.session.start();
    for (let index = 0; index < 2; index++) {
      const chunk = makeChunk(index, index * CHUNK_SAMPLES);
      harness.session.handleAudioChunk(chunk.meta, chunk.pcm);
    }
    await flushAsync();

    const attributed = harness.transcripts.map((event) => [
      event.segment.text,
      event.segment.speakerId,
    ]);
    expect(attributed).toContainEqual(['fala A', 'speaker-1']);
    expect(attributed).toContainEqual(['fala B', 'speaker-2']);
    await harness.session.end('user');
  });
});

describe('LiveSession resource limits', () => {
  it('rejects chunks while the pending window queue is saturated', async () => {
    const pending = deferred<TranscriptionResult>();
    const provider = new ScriptedTranscriptionProvider(() => pending.promise);
    const harness = createHarness({
      transcription: provider,
      config: { maxPendingWindows: 1 },
    });
    const { session } = harness;
    session.start();

    for (let index = 0; index < 4; index++) {
      const chunk = makeChunk(index, index * CHUNK_SAMPLES);
      session.handleAudioChunk(chunk.meta, chunk.pcm);
    }
    await flushAsync();

    const fifth = makeChunk(4, 4 * CHUNK_SAMPLES);
    const ack = session.handleAudioChunk(fifth.meta, fifth.pcm);

    expect(ack.accepted).toBe(false);
    expect(ack.reason).toBe('pending_limit');
    expect(ack.gap?.reason).toBe('pending_limit');
    session.cancel();
  });

  it('rejects a chunk that would overflow the rolling buffer', async () => {
    const pending = deferred<TranscriptionResult>();
    const provider = new ScriptedTranscriptionProvider(() => pending.promise);
    const harness = createHarness({
      transcription: provider,
      config: { maxBufferBytes: msToSamples(2000) * 2 },
    });
    const { session } = harness;
    session.start();

    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);
    await flushAsync();

    // Buffer holds the 500 ms overlap tail; a 2 s chunk no longer fits.
    const oversized = makeChunk(2, 32000, { samples: 32000 });
    const ack = session.handleAudioChunk(oversized.meta, oversized.pcm);

    expect(ack.accepted).toBe(false);
    expect(ack.reason).toBe('buffer_limit');
    expect(ack.gap?.reason).toBe('buffer_limit');
    session.cancel();
  });
});

describe('LiveSession snapshots and cursors', () => {
  it('returns a non-destructive snapshot filtered by cursor', async () => {
    const provider = new ScriptedTranscriptionProvider(() =>
      Promise.resolve({ text: 'fala transcrita', confidence: 0.9 }),
    );
    const harness = createHarness({ transcription: provider });
    const { session, segmenter } = harness;
    session.start();
    const first = makeChunk(0, 0);
    const second = makeChunk(1, 16000);
    session.handleAudioChunk(first.meta, first.pcm);
    session.handleAudioChunk(second.meta, second.pcm);
    await flushAsync();
    await session.end('user');

    const snapshot: LiveSessionSnapshot = session.getSnapshot();
    expect(snapshot.sessionId).toBe(SESSION_ID);
    expect(snapshot.state).toBe('ENDED');
    expect(snapshot.cursor).toBe(segmenter.getCursor());
    expect(snapshot.cursor).toBeGreaterThan(0);
    expect(snapshot.segments).toHaveLength(1);
    expect(snapshot.segments[0]?.text).toBe('fala transcrita');

    expect(session.getSnapshot(snapshot.cursor).segments).toEqual([]);
  });

  it('rejects cursors ahead of this instance', async () => {
    const { session } = createHarness();
    session.start();
    const chunk = makeChunk(0, 0);
    session.handleAudioChunk(chunk.meta, chunk.pcm);

    expect(() => session.resumeFromCursor(-1)).toThrow(LiveSessionCursorError);
    expect(() => session.resumeFromCursor(9999)).toThrow(
      LiveSessionCursorError,
    );

    await flushAsync();
    await session.end();
    expect(() => session.resumeFromCursor(0)).toThrow(LiveSessionStateError);
    expect(() => session.resumeFromCursor(9999)).toThrow(
      LiveSessionCursorError,
    );
  });
});

describe('LiveSession configuration', () => {
  it('reads LIVE_* environment overrides', () => {
    const config = liveSessionConfigFromEnv({
      LIVE_WINDOW_MS: '4000',
      LIVE_OVERLAP_MS: '500',
      LIVE_END_DRAIN_MS: '20000',
      LIVE_MAX_BUFFER_BYTES: '512000',
      LIVE_MAX_PENDING_WINDOWS: '8',
      LIVE_SILENCE_THRESHOLD: '0.01',
    });

    expect(config).toMatchObject({
      windowMs: 4000,
      overlapMs: 500,
      endDrainMs: 20000,
      maxBufferBytes: 512_000,
      maxPendingWindows: 8,
      silenceThreshold: 0.01,
    });
    expect(liveSessionConfigFromEnv({ LIVE_WINDOW_MS: 'nope' }).windowMs).toBe(
      8000,
    );
  });

  it('rejects overlapping windows larger than the window itself', () => {
    expect(
      () =>
        new LiveSession({
          sessionId: SESSION_ID,
          transcription: new ScriptedTranscriptionProvider(),
          segmenter: new SpeechSegmenter({ sessionId: SESSION_ID }),
          config: { windowMs: 1000, overlapMs: 1000 },
        }),
    ).toThrow(LiveSessionError);
    expect(
      () =>
        new LiveSession({
          sessionId: '   ',
          transcription: new ScriptedTranscriptionProvider(),
          segmenter: new SpeechSegmenter({ sessionId: SESSION_ID }),
        }),
    ).toThrow(LiveSessionError);
  });
});
