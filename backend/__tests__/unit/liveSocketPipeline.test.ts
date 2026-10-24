/**
 * Integration: Socket.IO → audio chunks → transcript → claims → verification.
 *
 * Real whisper.cpp / microphone audio is NOT available in this VM. Transcription,
 * claim extraction and investigation are injected fixtures/mocks.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  Claim,
  ClaimDetectedEvent,
  LiveSessionStartedEvent,
  TranscriptFinalEvent,
  Verification,
  VerificationResultEvent,
} from '@veritas/shared';
import { createWebSocketServer } from '#/ws/index.js';
import { attachLiveSessionHandlers } from '#/ws/liveHandlers.js';
import { LiveSessionRegistry } from '#/live/sessionRegistry.js';
import { UnknownSpeakerProvider } from '#/live/speakerIdentification.js';
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from '#/live/transcription.js';
import { msToSamples } from '#/live/wav.js';

const SESSION_ID = 'live-socket-test-1';
const WINDOW_MS = 1000;
const CHUNK_SAMPLES = msToSamples(WINDOW_MS);

class ScriptedTranscription implements TranscriptionProvider {
  readonly name = 'fixture-transcription';

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  transcribe(
    _pcm: Buffer,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    void options;
    return Promise.resolve({
      text: 'O Pix foi criado em 2015 pelo Banco Central.',
      confidence: 0.92,
      segments: [
        {
          text: 'O Pix foi criado em 2015 pelo Banco Central.',
          startMs: 0,
          endMs: options.durationMs,
          confidence: 0.92,
        },
      ],
    });
  }
}

const makePcm = (samples: number): Buffer => {
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    pcm.writeInt16LE((index % 2 === 0 ? 1 : -1) * 12_000, index * 2);
  }
  return pcm;
};

const waitFor = <T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload: T) => {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });

describe('live Socket.IO pipeline (LIVE-006/009–013)', () => {
  let closeServer: (() => Promise<void>) | undefined;
  let client: ClientSocket | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (closeServer !== undefined) {
      await closeServer();
      closeServer = undefined;
    }
  });

  it('receives audio, emits transcript/claims/verification over Socket.IO', async () => {
    const registry = new LiveSessionRegistry();
    const httpServer = createServer();
    const extractClaimsFn = vi.fn(
      (args: {
        text: string;
        source: { sessionId?: string; segmentIds: string[] };
      }): Promise<Claim[]> => {
        const now = new Date().toISOString();
        return Promise.resolve([
          {
            id: 'claim-fixture-1',
            sessionId: args.source.sessionId,
            segmentIds: [...args.source.segmentIds],
            originalQuote: 'O Pix foi criado em 2015 pelo Banco Central.',
            normalizedClaim: 'O Pix foi criado em 2015 pelo Banco Central.',
            status: 'DETECTED',
            notFactCheckable: false,
            atomicClaims: [
              {
                id: 'claim-fixture-1-atomic-0',
                proposition: 'O Pix foi criado em 2015 pelo Banco Central.',
                subject: 'Pix',
                period: { start: '2015', end: '2015' },
              },
            ],
            revision: 0,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      },
    );

    const investigateClaimFn = vi.fn(
      (args: { claim: Claim }): Promise<Verification> => {
        const now = new Date().toISOString();
        return Promise.resolve({
          id: `verification-${args.claim.id}-0`,
          sessionId: args.claim.sessionId,
          claimId: args.claim.id,
          segmentIds: [...args.claim.segmentIds],
          originalQuote: args.claim.originalQuote,
          normalizedClaim: args.claim.normalizedClaim,
          transcriptConfirmed: true,
          atomicClaim: args.claim.atomicClaims[0] ?? {
            id: `${args.claim.id}-atomic-0`,
            proposition: args.claim.normalizedClaim,
          },
          status: 'COMPLETED',
          verdict: 'FALSE',
          conclusion:
            'O Pix foi instituído em 2020; a data 2015 não é suportada.',
          contradiction: 'Instituição do Pix ocorreu em 2020.',
          contradictionEvidenceIds: ['ev-1'],
          mechanisms: [],
          supportedAspects: [],
          limitations: [],
          evidence: [
            {
              id: 'ev-1',
              sourceId: 'src-1',
              relation: 'REFUTES',
              claimIds: [args.claim.id],
              excerpt: 'O Pix entrou em operação em novembro de 2020.',
              explanation: 'Data oficial de lançamento.',
              verifiedContent: true,
            },
          ],
          sources: [
            {
              id: 'src-1',
              title: 'Banco Central — Pix',
              publisher: 'BCB',
              url: 'https://www.bcb.gov.br/estabilidadefinanceira/pix',
              type: 'PRIMARY',
              accessedAt: now,
            },
          ],
          revision: 0,
          reviewedBy: 'AUTOMATED',
          createdAt: now,
          updatedAt: now,
        });
      },
    );

    createWebSocketServer(httpServer, (socket) => {
      attachLiveSessionHandlers(socket, {
        registry,
        createTranscription: () => Promise.resolve(new ScriptedTranscription()),
        createDiarization: () => new UnknownSpeakerProvider(),
        pipelineOverrides: {
          extractClaimsFn: extractClaimsFn as never,
          investigateClaimFn,
          // Dummy LLMs — extract/investigate are fully mocked.
          extractionLlm: { invoke: vi.fn() } as unknown as BaseChatModel,
          evaluationLlm: { invoke: vi.fn() } as unknown as BaseChatModel,
          researchProvider: {
            search: () => Promise.resolve([]),
            extract: () =>
              Promise.resolve({
                url: 'https://example.com',
                title: 'x',
                content: 'y',
                extractedAt: new Date().toISOString(),
              }),
          },
          sessionConfig: {
            windowMs: WINDOW_MS,
            overlapMs: 0,
            endDrainMs: 2_000,
            maxPendingWindows: 8,
            maxBufferBytes: 256_000,
          },
          claimQueueOptions: {
            concurrency: 1,
            capacity: 4,
            timeoutMs: 5_000,
          },
        },
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = httpServer.address() as AddressInfo;
    closeServer = async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    };

    client = ioClient(`http://127.0.0.1:${String(address.port)}`, {
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      client?.once('connect', () => {
        resolve();
      });
      client?.once('connect_error', reject);
    });

    const started = waitFor<LiveSessionStartedEvent>(
      client,
      'LIVE_SESSION_STARTED',
      (event) => event.data.sessionId === SESSION_ID,
    );
    client.emit('START_LIVE_SESSION', {
      sessionId: SESSION_ID,
      source: 'MIC',
      language: 'pt-BR',
      consent: true,
      apiKeys: { google: 'test-google', tavily: 'tvly-test' },
    });
    await started;

    const finalTranscript = waitFor<TranscriptFinalEvent>(
      client,
      'TRANSCRIPT_FINAL',
    );
    const claimDetected = waitFor<ClaimDetectedEvent>(client, 'CLAIM_DETECTED');
    const verificationResult = waitFor<VerificationResultEvent>(
      client,
      'VERIFICATION_RESULT',
    );

    // Two windows of non-silent PCM so the segmenter can finalize on end().
    for (let seq = 0; seq < 2; seq++) {
      const pcm = makePcm(CHUNK_SAMPLES);
      client.emit(
        'AUDIO_CHUNK',
        {
          sessionId: SESSION_ID,
          chunkSeq: seq,
          encoding: 'pcm16le',
          sampleRate: 16000,
          channels: 1,
          samples: CHUNK_SAMPLES,
          startSample: seq * CHUNK_SAMPLES,
          capturedAt: new Date().toISOString(),
        },
        pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
      );
    }

    // Allow transcription jobs to run before ending.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const ended = waitFor(client, 'LIVE_SESSION_ENDED');
    client.emit('END_LIVE_SESSION', { sessionId: SESSION_ID });

    const [transcript, claimEvent, verificationEvent] = await Promise.all([
      finalTranscript,
      claimDetected,
      verificationResult,
      ended,
    ]);

    expect(transcript.data.segment.text).toContain('Pix');
    // Honest speaker attribution: UnknownSpeakerProvider → no fabricated name.
    expect(transcript.data.segment.speakerId).toBeUndefined();

    expect(claimEvent.data.claim.originalQuote).toContain('Pix');
    expect(claimEvent.data.claim.notFactCheckable).toBe(false);
    expect(claimEvent.data.claim.sessionId).toBe(SESSION_ID);

    expect(verificationEvent.data.verification.claimId).toBe(
      claimEvent.data.claim.id,
    );
    expect(verificationEvent.data.verification.status).toBe('COMPLETED');
    expect(verificationEvent.data.verification.verdict).toBe('FALSE');
    expect(verificationEvent.envelope.sessionId).toBe(SESSION_ID);
    expect(verificationEvent.envelope.eventSeq).toBeGreaterThan(0);

    expect(extractClaimsFn).toHaveBeenCalled();
    expect(investigateClaimFn).toHaveBeenCalled();
  });
});
