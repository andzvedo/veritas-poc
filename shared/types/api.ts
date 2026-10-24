import { z } from 'zod';
import type {
  AudioChunk,
  AudioChunkAckEvent,
  Claim,
  ClaimDetectedEvent,
  ClaimStatusUpdatedEvent,
  CorrectTranscript,
  DeleteSession,
  ExportSession,
  HumanReviewRecordedEvent,
  LiveGapData,
  LiveGapEvent,
  LiveMetricsData,
  LiveMetricsEvent,
  LiveSessionControl,
  LiveSessionEndedEvent,
  LiveSessionStartedEvent,
  LiveSessionState,
  LiveSessionStateEvent,
  ResumeSession,
  RetryVerification,
  SessionExportEvent,
  SessionSnapshotEvent,
  SpeakerMapping,
  SpeakerMappingUpdatedEvent,
  StartLiveSession,
  SubmitHumanReview,
  TranscriptFinalEvent,
  TranscriptPartialEvent,
  TranscriptRevisedEvent,
  TranscriptSegment,
  UpdateSpeakerMapping,
  Verification,
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
  SUBMIT_HUMAN_REVIEW: (payload: SubmitHumanReview) => void;
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
  SESSION_EXPORT: (data: SessionExportEvent) => void;
  HUMAN_REVIEW_RECORDED: (data: HumanReviewRecordedEvent) => void;
};

// ===== Estados da Verificação (Frontend) =====
export type VerificationStatus =
  | 'idle'
  | 'connecting'
  | 'processing'
  | 'finished'
  | 'error'
  | 'interrupted';

/**
 * Local capture / transport feedback distinct from server `LiveSessionState`
 * (LIVE-007: captura ativa, áudio ausente, atraso e saturação separados).
 */
export type LiveCaptureFeedback =
  | 'idle'
  | 'requesting_permission'
  | 'capturing'
  | 'paused'
  | 'no_audio'
  | 'permission_error'
  | 'unsupported'
  | 'connection_error'
  | 'ending'
  | 'ended';

export interface VerificationState {
  status: VerificationStatus;
  message?: string;
  /** Legacy text-mode progressive results (FACT_CHECK_RESULT). */
  results: FactCheckResult[];
  /**
   * Live / progressive verifications keyed by id+revision (LIVE-028).
   * Prefer this list for ResultsPage cards; text mode may bridge into it.
   */
  verifications: Verification[];
  /** Active live session; cross-session events must be ignored. */
  sessionId: string | null;
  /** Last applied server eventSeq / snapshot cursor for same-instance recovery. */
  eventCursor: number;
  /** Envelope eventIds already applied (dedupe on reconnect). */
  seenEventIds: string[];
  chunkCount?: number;
  error?: string;
  processedText: string;
  fingerprint: string | null;
  /** Server-authoritative live session state (LIVE-001/007). */
  liveSessionState: LiveSessionState | null;
  /** Progressive transcript segments (upsert by id+revision). */
  segments: TranscriptSegment[];
  /** Confirmed / provisional speaker name mappings. */
  speakerMappings: SpeakerMapping[];
  /** Mapping list revision from SPEAKER_MAPPING_UPDATED. */
  speakerMappingRevision: number;
  /** Detected claims used to highlight transcript spans (LIVE-026). */
  claims: Claim[];
  /** Segment ids whose local correction conflicted with a concurrent revision. */
  segmentConflicts: string[];
  /** Explicit audio / transport gaps (LIVE_GAP). */
  liveGaps: LiveGapData[];
  /** Last live metrics snapshot (queue depth, deferred research). */
  liveMetrics: LiveMetricsData | null;
  /** Local capture UI feedback (permission, share ended, …). */
  captureFeedback: LiveCaptureFeedback;
  /** Wall-clock of last applied TRANSCRIPT_* event (detect delay). */
  lastTranscriptAt: string | null;
}
