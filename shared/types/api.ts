import { z } from 'zod';
import type {
  AudioChunk,
  AudioChunkAckEvent,
  ClaimDetectedEvent,
  ClaimStatusUpdatedEvent,
  CorrectTranscript,
  DeleteSession,
  ExportSession,
  LiveGapEvent,
  LiveMetricsEvent,
  LiveSessionControl,
  LiveSessionEndedEvent,
  LiveSessionStartedEvent,
  LiveSessionStateEvent,
  ResumeSession,
  RetryVerification,
  SessionSnapshotEvent,
  SpeakerMappingUpdatedEvent,
  StartLiveSession,
  TranscriptFinalEvent,
  TranscriptPartialEvent,
  TranscriptRevisedEvent,
  UpdateSpeakerMapping,
  VerificationInvalidatedEvent,
  VerificationResultEvent,
} from './live.js';
import { TEXT_MODE_FACT_CHECK_RESULT_DATA_SCHEMA } from './textMode.js';

// ===== Schemas Zod =====
const METADATA_SCHEMA = z.object({
  fingerprint: z.string().min(1),
});

const RESULT_META_SCHEMA = METADATA_SCHEMA.extend({
  chunk: z.number().gte(0),
  seq: z.number().gte(0),
});

const buildResponseSchema = <Z extends z.ZodType, ZZ extends z.ZodType>(
  data: Z,
  meta: ZZ,
) => {
  return z.object({ data, meta });
};

export const FACT_CHECK_REQUEST_SCHEMA = METADATA_SCHEMA.pick({
  fingerprint: true,
}).extend({
  /**
   * Legacy field kept for client compatibility. The evidence pipeline ignores
   * it: research is no longer gated by model self-confidence (LIVE-017).
   */
  researchThreshold: z.number().gte(0).lte(1).optional(),
  apiKeys: z.object({
    google: z.string(),
    tavily: z.string(),
  }),
});

/**
 * Text-mode result contract (LIVE-016 migration).
 * Prefer `verification` when present; legacy fields are derived projections.
 */
export const FACT_CHECK_RESULT_DATA_SCHEMA =
  TEXT_MODE_FACT_CHECK_RESULT_DATA_SCHEMA;

export const FACT_CHECK_RESULT_SCHEMA = buildResponseSchema(
  FACT_CHECK_RESULT_DATA_SCHEMA,
  RESULT_META_SCHEMA,
);

export const UPDATE_STATUS_SCHEMA = buildResponseSchema(
  z.object({
    status: z.enum(['PROCESSING', 'FINISHED', 'EXCEPTION', 'INTERRUPTED']),
    message: z.string().optional(),
  }),
  METADATA_SCHEMA,
);

export const CHUNK_COUNT_SCHEMA = buildResponseSchema(
  z.object({
    chunkCount: z.number().gte(0),
  }),
  METADATA_SCHEMA,
);

// ===== TypeScript Types =====
export type FactCheckRequest = z.infer<typeof FACT_CHECK_REQUEST_SCHEMA>;
export type FactCheckResultData = z.infer<typeof FACT_CHECK_RESULT_DATA_SCHEMA>;
export type FactCheckResult = z.infer<typeof FACT_CHECK_RESULT_SCHEMA>;
export type UpdateStatus = z.infer<typeof UPDATE_STATUS_SCHEMA>;
export type UpdateStatusData = UpdateStatus['data'];
export type ChunkCount = z.infer<typeof CHUNK_COUNT_SCHEMA>;
export type ChunkCountData = ChunkCount['data'];

// ===== Socket.IO Events =====
export type ClientToServerEvents = {
  REQUEST_FACT_CHECK: (content: string, request: FactCheckRequest) => void;
  START_LIVE_SESSION: (payload: StartLiveSession) => void;
  AUDIO_CHUNK: (payload: AudioChunk, audio: ArrayBuffer) => void;
  PAUSE_LIVE_SESSION: (payload: LiveSessionControl) => void;
  RESUME_LIVE_SESSION: (payload: LiveSessionControl) => void;
  END_LIVE_SESSION: (payload: LiveSessionControl) => void;
  CANCEL_LIVE_SESSION: (payload: LiveSessionControl) => void;
  RESUME_SESSION: (payload: ResumeSession) => void;
  UPDATE_SPEAKER_MAPPING: (payload: UpdateSpeakerMapping) => void;
  CORRECT_TRANSCRIPT: (payload: CorrectTranscript) => void;
  RETRY_VERIFICATION: (payload: RetryVerification) => void;
  EXPORT_SESSION: (payload: ExportSession) => void;
  DELETE_SESSION: (payload: DeleteSession) => void;
};

export type ServerToClientEvents = {
  FACT_CHECK_RESULT: (data: FactCheckResult) => void;
  UPDATE_STATUS: (data: UpdateStatus) => void;
  CHUNK_COUNT: (data: ChunkCount) => void;
  LIVE_SESSION_STARTED: (data: LiveSessionStartedEvent) => void;
  LIVE_SESSION_STATE: (data: LiveSessionStateEvent) => void;
  TRANSCRIPT_PARTIAL: (data: TranscriptPartialEvent) => void;
  TRANSCRIPT_FINAL: (data: TranscriptFinalEvent) => void;
  TRANSCRIPT_REVISED: (data: TranscriptRevisedEvent) => void;
  SPEAKER_MAPPING_UPDATED: (data: SpeakerMappingUpdatedEvent) => void;
  CLAIM_DETECTED: (data: ClaimDetectedEvent) => void;
  CLAIM_STATUS_UPDATED: (data: ClaimStatusUpdatedEvent) => void;
  VERIFICATION_RESULT: (data: VerificationResultEvent) => void;
  VERIFICATION_INVALIDATED: (data: VerificationInvalidatedEvent) => void;
  SESSION_SNAPSHOT: (data: SessionSnapshotEvent) => void;
  LIVE_METRICS: (data: LiveMetricsEvent) => void;
  LIVE_GAP: (data: LiveGapEvent) => void;
  LIVE_SESSION_ENDED: (data: LiveSessionEndedEvent) => void;
  AUDIO_CHUNK_ACK: (data: AudioChunkAckEvent) => void;
};

// ===== Estados da Verificação (Frontend) =====
export type VerificationStatus =
  | 'idle'
  | 'connecting'
  | 'processing'
  | 'finished'
  | 'error'
  | 'interrupted';

export interface VerificationState {
  status: VerificationStatus;
  message?: string;
  results: FactCheckResult[];
  chunkCount?: number;
  error?: string;
  processedText: string;
  fingerprint: string | null;
}
