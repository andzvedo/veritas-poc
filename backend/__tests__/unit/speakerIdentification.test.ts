import { describe, expect, it, vi } from 'vitest';
import {
  DiarizationAbortedError,
  DiarizationTimeoutError,
  DiarizationUnavailableError,
  PyannoteHttpAdapter,
  SpeakerIdentificationError,
  SpeakerMappingConflictError,
  SpeakerMappingValidationError,
  SpeakerRegistry,
  UnknownSpeakerError,
  UnknownSpeakerProvider,
  parsePyannoteResponse,
  resolveSpeakerLabelForInterval,
  windowDurationMs,
  type DiarizationProvider,
  type FetchLike,
} from '#/live/speakerIdentification.js';
import { parseWavHeader } from '#/live/wav.js';

const pcm = (samples = 1600): Buffer => {
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    buffer.writeInt16LE(((index % 40) - 20) * 900, index * 2);
  }
  return buffer;
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('UnknownSpeakerProvider', () => {
  it('is always available and never invents a speaker', async () => {
    const provider: DiarizationProvider = new UnknownSpeakerProvider();

    expect(provider.name).toBe('unknown-speaker');
    expect(await provider.isAvailable()).toBe(true);
    await expect(
      provider.identify(pcm(), { startMs: 0, endMs: 1000 }),
    ).resolves.toEqual([]);
  });
});

describe('parsePyannoteResponse', () => {
  it('parses array and wrapped response shapes', () => {
    expect(
      parsePyannoteResponse([
        { speaker: 'SPEAKER_00', confidence: 0.7 },
        { speaker: 'SPEAKER_00', score: 0.9 },
        { label: 3 },
      ]),
    ).toEqual([
      { speakerLabel: 'SPEAKER_00', confidence: 0.9 },
      { speakerLabel: '3' },
    ]);

    expect(
      parsePyannoteResponse({ segments: [{ speaker: 'A' }, { speaker: 'B' }] }),
    ).toEqual([{ speakerLabel: 'A' }, { speakerLabel: 'B' }]);
    expect(parsePyannoteResponse({ diarization: [{ label: 'X' }] })).toEqual([
      { speakerLabel: 'X' },
    ]);
  });

  it('returns no observations for unknown shapes or missing labels', () => {
    expect(parsePyannoteResponse({})).toEqual([]);
    expect(parsePyannoteResponse('nope')).toEqual([]);
    expect(parsePyannoteResponse([{ confidence: 0.5 }])).toEqual([]);
    expect(parsePyannoteResponse([{ speaker: '   ' }])).toEqual([]);
  });

  it('keeps turn timestamps and converts seconds to window-relative milliseconds', () => {
    expect(
      parsePyannoteResponse({
        segments: [
          { speaker: 'A', start: 0.25, end: 1.5 },
          { speaker: 'B', start_ms: 1500, end_ms: 2250 },
        ],
      }),
    ).toEqual([
      { speakerLabel: 'A', startMs: 250, endMs: 1500 },
      { speakerLabel: 'B', startMs: 1500, endMs: 2250 },
    ]);
  });
});

describe('resolveSpeakerLabelForInterval', () => {
  it('attributes each transcript segment from the matching diarization turn', () => {
    const observations = [
      { speakerLabel: 'A', startMs: 0, endMs: 3000 },
      { speakerLabel: 'B', startMs: 3000, endMs: 6000 },
    ];

    expect(resolveSpeakerLabelForInterval(observations, 500, 2500, 6000)).toBe(
      'A',
    );
    expect(resolveSpeakerLabelForInterval(observations, 3500, 5500, 6000)).toBe(
      'B',
    );
  });

  it('keeps mixed, overlapping, and weakly covered speech unattributed', () => {
    expect(
      resolveSpeakerLabelForInterval(
        [
          { speakerLabel: 'A', startMs: 0, endMs: 1000 },
          { speakerLabel: 'B', startMs: 900, endMs: 2000 },
        ],
        800,
        1200,
        2000,
      ),
    ).toBeUndefined();
    expect(
      resolveSpeakerLabelForInterval(
        [
          { speakerLabel: 'A', startMs: 0, endMs: 500 },
          { speakerLabel: 'B', startMs: 500, endMs: 1000 },
        ],
        250,
        750,
        1000,
      ),
    ).toBeUndefined();
  });

  it('does not infer labels from untimed multi-speaker responses', () => {
    expect(
      resolveSpeakerLabelForInterval(
        [{ speakerLabel: 'A' }, { speakerLabel: 'B' }],
        0,
        1000,
        1000,
      ),
    ).toBeUndefined();
  });

  it('keeps explicitly low-confidence diarization unknown', () => {
    expect(
      resolveSpeakerLabelForInterval(
        [{ speakerLabel: 'A', confidence: 0.5, startMs: 0, endMs: 1000 }],
        100,
        900,
        1000,
      ),
    ).toBeUndefined();
  });
});

describe('PyannoteHttpAdapter', () => {
  it('is unavailable without PYANNOTE_URL and fails clearly', async () => {
    const adapter = new PyannoteHttpAdapter({ env: {} });

    expect(await adapter.isAvailable()).toBe(false);
    await expect(
      adapter.identify(pcm(), { startMs: 0, endMs: 1000 }),
    ).rejects.toBeInstanceOf(DiarizationUnavailableError);
  });

  it('probes the endpoint once and caches the result', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 405 }));
    };
    const adapter = new PyannoteHttpAdapter({
      url: 'http://localhost:8000/diarize',
      env: {},
      fetchImpl,
    });

    expect(await adapter.isAvailable()).toBe(true);
    expect(await adapter.isAvailable()).toBe(true);
    expect(calls).toBe(1);
    adapter.resetAvailabilityCache();
    expect(await adapter.isAvailable()).toBe(true);
    expect(calls).toBe(2);
  });

  it('reports unavailable when the endpoint errors', async () => {
    const adapter = new PyannoteHttpAdapter({
      url: 'http://localhost:8000/diarize',
      env: {},
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    expect(await adapter.isAvailable()).toBe(false);
  });

  it('posts the WAV window with bounded time parameters', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(
        jsonResponse({
          segments: [
            { speaker: 'SPEAKER_00', confidence: 0.8 },
            { speaker: 'SPEAKER_01', confidence: 0.6 },
          ],
        }),
      );
    };
    const adapter = new PyannoteHttpAdapter({
      url: 'http://localhost:8000/diarize',
      env: {},
      fetchImpl,
    });

    const observations = await adapter.identify(pcm(), {
      sessionId: 'session-1',
      startMs: 2000,
      endMs: 6000,
    });

    expect(observations).toEqual([
      { speakerLabel: 'SPEAKER_00', confidence: 0.8 },
      { speakerLabel: 'SPEAKER_01', confidence: 0.6 },
    ]);
    const request = requests.at(0);
    expect(request?.init.method).toBe('POST');
    expect(request?.url).toContain('start_ms=2000');
    expect(request?.url).toContain('end_ms=6000');
    expect(request?.url).toContain('sample_rate=16000');
    expect(request?.url).toContain('session_id=session-1');
    expect(request?.init.headers).toMatchObject({
      'content-type': 'audio/wav',
    });

    const body = request?.init.body;
    expect(body).toBeInstanceOf(Uint8Array);
    if (!(body instanceof Uint8Array)) {
      return;
    }
    const wav = Buffer.from(body);
    expect(parseWavHeader(wav).dataBytes).toBe(pcm().length);
  });

  it('surfaces HTTP failures', async () => {
    const adapter = new PyannoteHttpAdapter({
      url: 'http://localhost:8000/diarize',
      env: {},
      fetchImpl: () => Promise.resolve(new Response('boom', { status: 500 })),
    });

    const error = await adapter
      .identify(pcm(), { startMs: 0, endMs: 1000 })
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(SpeakerIdentificationError);
    expect((error as Error).message).toContain('500');
  });

  it('aborts and times out with typed errors', async () => {
    const hangingFetch: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const adapter = new PyannoteHttpAdapter({
      url: 'http://localhost:8000/diarize',
      env: {},
      fetchImpl: hangingFetch,
    });

    const controller = new AbortController();
    const pending = adapter.identify(pcm(), {
      startMs: 0,
      endMs: 1000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DiarizationAbortedError);

    vi.useFakeTimers();
    try {
      const timeoutAdapter = new PyannoteHttpAdapter({
        url: 'http://localhost:8000/diarize',
        timeoutMs: 25,
        env: {},
        fetchImpl: hangingFetch,
      });
      const timeoutPending = timeoutAdapter
        .identify(pcm(), { startMs: 0, endMs: 1000 })
        .catch((thrown: unknown) => thrown);
      await vi.advanceTimersByTimeAsync(30);
      await expect(timeoutPending).resolves.toBeInstanceOf(
        DiarizationTimeoutError,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SpeakerRegistry', () => {
  it('assigns stable session ids in first-seen order', () => {
    const registry = new SpeakerRegistry();

    const first = registry.observe('SPEAKER_00');
    const second = registry.observe('SPEAKER_01');

    expect(first).toBe('speaker-1');
    expect(second).toBe('speaker-2');
    expect(registry.observe('SPEAKER_00')).toBe(first);
    expect(registry.getSpeakerId('SPEAKER_00')).toBe(first);
    expect(registry.getSpeakerId('SPEAKER_01')).toBe(second);
    expect(registry.getSpeakerId('never-seen')).toBeUndefined();
    expect(registry.getSpeakerLabel(second)).toBe('SPEAKER_01');
    expect(registry.getSpeakerIds()).toEqual(['speaker-1', 'speaker-2']);
  });

  it('keeps unknown speakers undefined instead of guessing', () => {
    const registry = new SpeakerRegistry();
    registry.observe('SPEAKER_00');

    expect(registry.getSpeakerIdForSegment({})).toBeUndefined();
    expect(
      registry.getSpeakerIdForSegment({ speakerId: 'speaker-9' }),
    ).toBeUndefined();
    expect(
      registry.getSpeakerIdForSegment({ speakerId: 'SPEAKER_00' }),
    ).toBeUndefined();
    expect(registry.getParticipantName('speaker-1')).toBeUndefined();
    expect(registry.getMappings()).toEqual([]);
    expect(registry.getRevision()).toBe(0);
    expect(() => registry.observe('   ')).toThrow(
      SpeakerMappingValidationError,
    );
  });

  it('requires a manual, revision-checked mapping for names', () => {
    const registry = new SpeakerRegistry();
    const speakerId = registry.observe('SPEAKER_00');

    expect(() => registry.setMapping('speaker-404', 'Fulano', 0)).toThrow(
      UnknownSpeakerError,
    );
    expect(() => registry.setMapping(speakerId, '   ', 0)).toThrow(
      SpeakerMappingValidationError,
    );

    const mapping = registry.setMapping(speakerId, '  Candidato A  ', 0);
    expect(mapping).toEqual({
      speakerId,
      participantName: 'Candidato A',
      confirmed: false,
      revision: 1,
    });
    expect(registry.getRevision()).toBe(1);
    expect(registry.getParticipantName(speakerId)).toBe('Candidato A');
    expect(registry.getMappings()).toEqual([mapping]);

    expect(() => registry.setMapping(speakerId, 'Candidato B', 0)).toThrow(
      SpeakerMappingConflictError,
    );
    try {
      registry.setMapping(speakerId, 'Candidato B', 0);
    } catch (error) {
      const conflict = error as SpeakerMappingConflictError;
      expect(conflict.expectedRevision).toBe(0);
      expect(conflict.actualRevision).toBe(1);
    }

    const updated = registry.setMapping(speakerId, 'Candidato B', 1);
    expect(updated.revision).toBe(2);
    expect(registry.getParticipantName(speakerId)).toBe('Candidato B');

    const confirmed = registry.confirmMapping(speakerId, 2);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.revision).toBe(3);
    expect(registry.getMapping(speakerId)?.confirmed).toBe(true);
    expect(() => registry.confirmMapping('speaker-404', 3)).toThrow(
      SpeakerMappingValidationError,
    );
  });

  it('never infers identity from turn order or transcript content', () => {
    const registry = new SpeakerRegistry();
    // Alternating turns are the classic wrong heuristic: A, B, A, B.
    const first = registry.observe('SPEAKER_00');
    const second = registry.observe('SPEAKER_01');
    registry.observe('SPEAKER_00');
    registry.observe('SPEAKER_01');

    // No name appears without an explicit mapping, regardless of order.
    expect(registry.getParticipantName(first)).toBeUndefined();
    expect(registry.getParticipantName(second)).toBeUndefined();
    expect(registry.getMappings()).toEqual([]);
    // The acoustic id is available, but authorship remains anonymous.
    expect(registry.getSpeakerIdForSegment({ speakerId: first })).toBe(first);
  });
});

describe('windowDurationMs', () => {
  it('derives the media duration of a PCM window', () => {
    expect(windowDurationMs(Buffer.alloc(32000))).toBe(1000);
    expect(windowDurationMs(Buffer.alloc(0))).toBe(0);
  });
});
