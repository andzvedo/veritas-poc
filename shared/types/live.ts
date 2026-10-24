import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

const ISO_DATETIME_SCHEMA = z.iso.datetime({ offset: true });

/**
 * Runtime limits for client → server payloads (LIVE-038). Socket.IO messages
 * are untrusted input: ids, texts and arrays are bounded before reaching the
 * pipeline. Binary audio is additionally capped by the transport
 * (`maxHttpBufferSize`) and by `maxChunkSamples`.
 */
export const LIVE_PAYLOAD_LIMITS = {
  maxIdLength: 128,
  maxCorrectionChars: 4_000,
  maxSpeakerMappings: 32,
  maxParticipantNameChars: 120,
  maxApiKeyChars: 512,
  maxReviewNoteChars: 2_000,
  /** 10 s of 16 kHz mono audio per chunk. */
  maxChunkSamples: 160_000,
  maxResumeTokenChars: 256,
} as const;

/** Opaque identifier (session, segment, verification…) sent by the client. */
export const LIVE_ID_SCHEMA = z
  .string()
  .min(1)
  .max(LIVE_PAYLOAD_LIMITS.maxIdLength)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Identificador com caracteres inválidos');

// ===== Sessão =====
export const LIVE_SESSION_STATE_SCHEMA = z.enum([
  'IDLE',
  'CONNECTING',
  'LISTENING',
  'PAUSED',
  'ENDING',
  'ENDED',
  'RECONNECTING',
  'ERROR',
]);
export type LiveSessionState = z.infer<typeof LIVE_SESSION_STATE_SCHEMA>;

// ===== Áudio e transcrição =====
export const AUDIO_CHUNK_META_SCHEMA = z.object({
  chunkSeq: z.number().int().gte(0),
  encoding: z.literal('pcm16le'),
  sampleRate: z.literal(16000),
  channels: z.literal(1),
  samples: z.number().int().gt(0).lte(LIVE_PAYLOAD_LIMITS.maxChunkSamples),
  startSample: z.number().int().gte(0),
  capturedAt: ISO_DATETIME_SCHEMA,
});
export type AudioChunkMeta = z.infer<typeof AUDIO_CHUNK_META_SCHEMA>;

export const TRANSCRIPT_SEGMENT_STATUS_SCHEMA = z.enum([
  'PROVISIONAL',
  'FINAL',
  'BLOCKED',
]);
export type TranscriptSegmentStatus = z.infer<
  typeof TRANSCRIPT_SEGMENT_STATUS_SCHEMA
>;

export const UNCERTAINTY_REASON_SCHEMA = z.enum([
  'NUMBER',
  'NEGATION',
  'SUBJECT',
  'OVERLAP',
  'LOW_CONFIDENCE',
  'TRANSCRIPTION_ERROR',
]);
export type UncertaintyReason = z.infer<typeof UNCERTAINTY_REASON_SCHEMA>;

export const TRANSCRIPT_SEGMENT_SCHEMA = z.object({
  id: z.string(),
  sessionId: z.string(),
  revision: z.number().int().gte(0),
  status: TRANSCRIPT_SEGMENT_STATUS_SCHEMA,
  text: z.string().min(1),
  speakerId: z.string().optional(),
  startMs: z.number().int().gte(0),
  endMs: z.number().int().gte(0),
  confidence: z.number().gte(0).lte(1).optional(),
  uncertaintyReasons: z.array(UNCERTAINTY_REASON_SCHEMA).optional(),
  createdAt: ISO_DATETIME_SCHEMA,
});
export type TranscriptSegment = z.infer<typeof TRANSCRIPT_SEGMENT_SCHEMA>;

export const SPEAKER_MAPPING_SCHEMA = z.object({
  speakerId: z.string(),
  participantName: z.string().min(1),
  confirmed: z.boolean(),
  revision: z.number().int().gte(0),
});
export type SpeakerMapping = z.infer<typeof SPEAKER_MAPPING_SCHEMA>;

// ===== Claims =====
export const ATOMIC_CLAIM_SCHEMA = z.object({
  id: z.string(),
  proposition: z.string().min(1),
  subject: z.string().optional(),
  predicate: z.string().optional(),
  period: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  populationOrScope: z.string().optional(),
  quantity: z
    .object({
      value: z.number(),
      unit: z.string().min(1),
    })
    .optional(),
});
export type AtomicClaim = z.infer<typeof ATOMIC_CLAIM_SCHEMA>;

export const CLAIM_STATUS_SCHEMA = z.enum([
  'DETECTED',
  'QUEUED',
  'RESEARCHING',
  'EVALUATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'DEFERRED',
  'BLOCKED',
]);
export type ClaimStatus = z.infer<typeof CLAIM_STATUS_SCHEMA>;

export const CLAIM_SCHEMA = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  segmentIds: z.array(z.string()).min(1),
  speakerId: z.string().optional(),
  originalQuote: z.string().min(1),
  normalizedClaim: z.string().min(1),
  timestampMs: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .optional(),
  status: CLAIM_STATUS_SCHEMA,
  notFactCheckable: z.boolean(),
  atomicClaims: z.array(ATOMIC_CLAIM_SCHEMA),
  revision: z.number().int().gte(0),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
});
export type Claim = z.infer<typeof CLAIM_SCHEMA>;

// ===== Fontes e evidências =====
export const VERDICT_SCHEMA = z.enum([
  'SUPPORTED',
  'FALSE',
  'MISLEADING',
  'INCONCLUSIVE',
]);
export type Verdict = z.infer<typeof VERDICT_SCHEMA>;

export const EVIDENCE_RELATION_SCHEMA = z.enum([
  'SUPPORTS',
  'REFUTES',
  'CONTEXTUALIZES',
]);
export type EvidenceRelation = z.infer<typeof EVIDENCE_RELATION_SCHEMA>;

export const SOURCE_TYPE_SCHEMA = z.enum([
  'PRIMARY',
  'SECONDARY',
  'PARTISAN',
  'OTHER',
]);
export type SourceType = z.infer<typeof SOURCE_TYPE_SCHEMA>;

export const MECHANISM_CODE_SCHEMA = z.enum([
  'FALSE_ORIGIN_ATTRIBUTION',
  'MISATTRIBUTED_AGGREGATE',
  'OMITTED_TIME_LIMIT',
  'PROGRAM_CONFLATION',
  'INCOMPATIBLE_COMPARISON',
  'UNSUPPORTED_CAUSALITY',
  'SELECTIVE_PERIOD',
  'OVERGENERALIZATION',
  'SELECTIVE_EVIDENCE',
]);
export type MechanismCode = z.infer<typeof MECHANISM_CODE_SCHEMA>;

export const SOURCE_SCHEMA = z.object({
  id: z.string(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  type: SOURCE_TYPE_SCHEMA,
  publishedAt: ISO_DATETIME_SCHEMA.optional(),
  accessedAt: ISO_DATETIME_SCHEMA,
  dataPeriod: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  contentHash: z.string().optional(),
});
export type Source = z.infer<typeof SOURCE_SCHEMA>;

export const EVIDENCE_SCHEMA = z.object({
  id: z.string(),
  sourceId: z.string(),
  relation: EVIDENCE_RELATION_SCHEMA,
  claimIds: z.array(z.string()).min(1),
  excerpt: z.string().min(1),
  location: z.string().optional(),
  explanation: z.string().min(1),
  verifiedContent: z.boolean(),
});
export type Evidence = z.infer<typeof EVIDENCE_SCHEMA>;

export const MECHANISM_SCHEMA = z.object({
  code: MECHANISM_CODE_SCHEMA,
  explanation: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1),
});
export type Mechanism = z.infer<typeof MECHANISM_SCHEMA>;

// ===== Verificação =====
const REVIEWER_SCHEMA = z.enum(['AUTOMATED', 'HUMAN']);

const VERIFICATION_SHAPE_SCHEMA = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  claimId: z.string(),
  segmentIds: z.array(z.string()).min(1),
  speakerId: z.string().optional(),
  originalQuote: z.string().min(1),
  normalizedClaim: z.string().min(1),
  timestampMs: z
    .object({
      start: z.number(),
      end: z.number(),
    })
    .optional(),
  transcriptConfirmed: z.boolean(),
  atomicClaim: ATOMIC_CLAIM_SCHEMA,
  status: CLAIM_STATUS_SCHEMA,
  verdict: VERDICT_SCHEMA.optional(),
  conclusion: z.string().optional(),
  contradiction: z.string().optional(),
  contradictionEvidenceIds: z.array(z.string()).optional(),
  mechanisms: z.array(MECHANISM_SCHEMA).default([]),
  supportedAspects: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
  evidence: z.array(EVIDENCE_SCHEMA).default([]),
  sources: z.array(SOURCE_SCHEMA).default([]),
  revision: z.number().int().gte(0),
  reviewedBy: REVIEWER_SCHEMA.optional(),
  createdAt: ISO_DATETIME_SCHEMA,
  updatedAt: ISO_DATETIME_SCHEMA,
});

export const VERIFICATION_SCHEMA = VERIFICATION_SHAPE_SCHEMA.superRefine(
  (verification, ctx) => {
    const evidenceById = new Map(
      verification.evidence.map((item) => [item.id, item]),
    );
    const evidenceIds = new Set<string>();
    const sourceIds = new Set<string>();
    const sourceUrls = new Set<string>();
    const contradictionEvidenceIds =
      verification.contradictionEvidenceIds ?? [];
    const conclusion = verification.conclusion?.trim() ?? '';
    const contradiction = verification.contradiction?.trim() ?? '';
    const isCompleted = verification.status === 'COMPLETED';

    if (!isCompleted) {
      if (verification.verdict !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Only COMPLETED verifications may carry a verdict.',
          path: ['verdict'],
        });
      }
      if (verification.conclusion !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Only COMPLETED verifications may carry a conclusion.',
          path: ['conclusion'],
        });
      }
      if (verification.contradiction !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Only COMPLETED verifications may carry a contradiction.',
          path: ['contradiction'],
        });
      }
      if (contradictionEvidenceIds.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message:
            'Only COMPLETED verifications may carry contradiction evidence.',
          path: ['contradictionEvidenceIds'],
        });
      }
    } else {
      if (verification.verdict === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'COMPLETED verification requires a verdict.',
          path: ['verdict'],
        });
      }
      if (conclusion.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'COMPLETED verification requires a non-empty conclusion.',
          path: ['conclusion'],
        });
      }
    }

    switch (verification.verdict) {
      case 'FALSE': {
        if (contradiction.length === 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'FALSE verification requires a contradiction.',
            path: ['contradiction'],
          });
        }
        if (contradictionEvidenceIds.length === 0) {
          ctx.addIssue({
            code: 'custom',
            message:
              'FALSE verification requires at least one contradiction evidence id.',
            path: ['contradictionEvidenceIds'],
          });
        }
        contradictionEvidenceIds.forEach((evidenceId, index) => {
          const evidence = evidenceById.get(evidenceId);
          if (evidence === undefined) {
            ctx.addIssue({
              code: 'custom',
              message: `Contradiction evidence "${evidenceId}" does not exist.`,
              path: ['contradictionEvidenceIds', index],
            });
            return;
          }
          if (evidence.relation !== 'REFUTES' || !evidence.verifiedContent) {
            ctx.addIssue({
              code: 'custom',
              message: `Contradiction evidence "${evidenceId}" must REFUTE the claim and be verified.`,
              path: ['contradictionEvidenceIds', index],
            });
          }
        });
        break;
      }
      case 'SUPPORTED': {
        const hasVerifiedSupport = verification.evidence.some(
          (item) => item.relation === 'SUPPORTS' && item.verifiedContent,
        );
        if (!hasVerifiedSupport) {
          ctx.addIssue({
            code: 'custom',
            message:
              'SUPPORTED verification requires verified supporting evidence.',
            path: ['evidence'],
          });
        }
        break;
      }
      case 'MISLEADING': {
        if (verification.supportedAspects.length === 0) {
          ctx.addIssue({
            code: 'custom',
            message:
              'MISLEADING verification requires at least one supported aspect.',
            path: ['supportedAspects'],
          });
        }
        if (verification.mechanisms.length === 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'MISLEADING verification requires at least one mechanism.',
            path: ['mechanisms'],
          });
        }
        verification.mechanisms.forEach((mechanism, mechanismIndex) => {
          mechanism.evidenceIds.forEach((evidenceId, evidenceIndex) => {
            const evidence = evidenceById.get(evidenceId);
            if (evidence !== undefined && !evidence.verifiedContent) {
              ctx.addIssue({
                code: 'custom',
                message: `Mechanism evidence "${evidenceId}" must be verified.`,
                path: [
                  'mechanisms',
                  mechanismIndex,
                  'evidenceIds',
                  evidenceIndex,
                ],
              });
            }
          });
        });
        break;
      }
      default:
        break;
    }

    verification.sources.forEach((source, index) => {
      if (sourceIds.has(source.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicated source id "${source.id}".`,
          path: ['sources', index, 'id'],
        });
      }
      sourceIds.add(source.id);

      if (sourceUrls.has(source.url)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicated source url "${source.url}".`,
          path: ['sources', index, 'url'],
        });
      }
      sourceUrls.add(source.url);
    });

    verification.evidence.forEach((item, index) => {
      if (evidenceIds.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicated evidence id "${item.id}".`,
          path: ['evidence', index, 'id'],
        });
      }
      evidenceIds.add(item.id);

      if (!sourceIds.has(item.sourceId)) {
        ctx.addIssue({
          code: 'custom',
          message: `Evidence source "${item.sourceId}" does not exist.`,
          path: ['evidence', index, 'sourceId'],
        });
      }

      if (item.claimIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Evidence must reference at least one claim.',
          path: ['evidence', index, 'claimIds'],
        });
      }
    });

    verification.mechanisms.forEach((mechanism, mechanismIndex) => {
      mechanism.evidenceIds.forEach((evidenceId, evidenceIndex) => {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Mechanism evidence "${evidenceId}" does not exist.`,
            path: ['mechanisms', mechanismIndex, 'evidenceIds', evidenceIndex],
          });
        }
      });
    });
  },
);
export type Verification = z.infer<typeof VERIFICATION_SCHEMA>;

// ===== Revisões, invalidação e auditoria (LIVE-040) =====
/** Reference to one revision of an entity (segment, claim, context…). */
export const REVISION_REF_SCHEMA = z.object({
  id: z.string(),
  revision: z.number().int().gte(0),
});
export type RevisionRef = z.infer<typeof REVISION_REF_SCHEMA>;

/** Why a dependent conclusion stopped being current. */
export const INVALIDATION_CAUSE_SCHEMA = z.enum([
  'TRANSCRIPT_CORRECTION',
  'CONTEXT_CHANGED',
  'SPEAKER_MAPPING_CHANGED',
  'RETRY_REQUESTED',
]);
export type InvalidationCause = z.infer<typeof INVALIDATION_CAUSE_SCHEMA>;

/**
 * Classification of a text change. `TYPOGRAPHIC` (case, spacing or
 * punctuation outside numbers) is the only kind that does not invalidate.
 */
export const TEXT_CHANGE_KIND_SCHEMA = z.enum([
  'TYPOGRAPHIC',
  'NUMBER',
  'NEGATION',
  'WORDING',
]);
export type TextChangeKind = z.infer<typeof TEXT_CHANGE_KIND_SCHEMA>;

export const REVISION_DIFF_SCHEMA = z.object({
  field: z.enum(['TRANSCRIPT', 'SPEAKER', 'CONTEXT', 'NONE']),
  before: z.string().optional(),
  after: z.string().optional(),
  changeKinds: z.array(TEXT_CHANGE_KIND_SCHEMA).default([]),
});
export type RevisionDiff = z.infer<typeof REVISION_DIFF_SCHEMA>;

/** Revisions of every input an investigation attempt depended on. */
export const VERIFICATION_INPUTS_SCHEMA = z.object({
  claimRef: REVISION_REF_SCHEMA,
  segmentRefs: z.array(REVISION_REF_SCHEMA),
  contextRefs: z.array(REVISION_REF_SCHEMA),
  speakerId: z.string().optional(),
  speakerMappingRevision: z.number().int().gte(0).optional(),
  speakerName: z.string().optional(),
});
export type VerificationInputs = z.infer<typeof VERIFICATION_INPUTS_SCHEMA>;

export const VERIFICATION_ATTEMPT_STATUS_SCHEMA = z.enum([
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'DEFERRED',
  'CANCELLED',
  'DISCARDED_STALE',
  'SUPERSEDED',
]);
export type VerificationAttemptStatus = z.infer<
  typeof VERIFICATION_ATTEMPT_STATUS_SCHEMA
>;

/** One automated investigation attempt of one claim (immutable inputs). */
export const VERIFICATION_ATTEMPT_RECORD_SCHEMA = z.object({
  id: z.string(),
  verificationId: z.string(),
  claimId: z.string(),
  attemptNumber: z.number().int().gte(1),
  inputs: VERIFICATION_INPUTS_SCHEMA,
  status: VERIFICATION_ATTEMPT_STATUS_SCHEMA,
  /** Automated checks only; human reviews live in `HUMAN_REVIEW_RECORD`. */
  reviewType: z.literal('AUTOMATED'),
  startedAt: ISO_DATETIME_SCHEMA,
  finishedAt: ISO_DATETIME_SCHEMA.optional(),
  resultRevision: z.number().int().gte(0).optional(),
  verdict: VERDICT_SCHEMA.optional(),
  reason: z.string().optional(),
});
export type VerificationAttemptRecord = z.infer<
  typeof VERIFICATION_ATTEMPT_RECORD_SCHEMA
>;

export const VERIFICATION_INVALIDATION_RECORD_SCHEMA = z.object({
  verificationId: z.string(),
  claimId: z.string(),
  /** Verification revision after invalidation (supersedes every older one). */
  revision: z.number().int().gte(0),
  cause: INVALIDATION_CAUSE_SCHEMA,
  reason: z.string(),
  invalidatedAt: ISO_DATETIME_SCHEMA,
  attemptId: z.string().optional(),
  previousVerdict: VERDICT_SCHEMA.optional(),
  diff: REVISION_DIFF_SCHEMA.optional(),
});
export type VerificationInvalidationRecord = z.infer<
  typeof VERIFICATION_INVALIDATION_RECORD_SCHEMA
>;

export const HUMAN_REVIEW_DECISION_SCHEMA = z.enum([
  'CONFIRMED',
  'DISPUTED',
  'NOTE',
]);
export type HumanReviewDecision = z.infer<typeof HUMAN_REVIEW_DECISION_SCHEMA>;

export const HUMAN_REVIEW_RECORD_SCHEMA = z.object({
  id: z.string(),
  verificationId: z.string(),
  verificationRevision: z.number().int().gte(0),
  reviewType: z.literal('HUMAN'),
  decision: HUMAN_REVIEW_DECISION_SCHEMA,
  note: z.string().optional(),
  reviewedAt: ISO_DATETIME_SCHEMA,
});
export type HumanReviewRecord = z.infer<typeof HUMAN_REVIEW_RECORD_SCHEMA>;

/** Decision applied when a correction is purely typographic. */
export const TYPOGRAPHIC_CORRECTION_RECORD_SCHEMA = z.object({
  segmentId: z.string(),
  fromRevision: z.number().int().gte(0),
  toRevision: z.number().int().gte(0),
  decision: z.literal('KEEP_RESULTS'),
  recordedAt: ISO_DATETIME_SCHEMA,
  diff: REVISION_DIFF_SCHEMA,
});
export type TypographicCorrectionRecord = z.infer<
  typeof TYPOGRAPHIC_CORRECTION_RECORD_SCHEMA
>;

/** Published in-memory retention limits of the current session (P0). */
export const LIVE_RETENTION_POLICY_SCHEMA = z.object({
  storage: z.literal('MEMORY_ONLY'),
  durableAfterRestart: z.literal(false),
  idleTtlMs: z.number().int().gt(0),
  maxSessionMs: z.number().int().gt(0),
  maxAttemptsPerVerification: z.number().int().gt(0),
  maxAuditRecords: z.number().int().gt(0),
  audioPersisted: z.literal(false),
  voiceRepresentationsPersisted: z.literal(false),
  credentialsExported: z.literal(false),
});
export type LiveRetentionPolicy = z.infer<typeof LIVE_RETENTION_POLICY_SCHEMA>;

export const SESSION_AUDIT_SCHEMA = z.object({
  attempts: z.array(VERIFICATION_ATTEMPT_RECORD_SCHEMA),
  invalidations: z.array(VERIFICATION_INVALIDATION_RECORD_SCHEMA),
  humanReviews: z.array(HUMAN_REVIEW_RECORD_SCHEMA),
  typographicCorrections: z.array(TYPOGRAPHIC_CORRECTION_RECORD_SCHEMA),
  /** Records dropped by the retention caps (never silently). */
  truncated: z.number().int().gte(0),
});
export type SessionAudit = z.infer<typeof SESSION_AUDIT_SCHEMA>;

export const SEGMENT_REVISION_RECORD_SCHEMA = z.object({
  segmentId: z.string(),
  revision: z.number().int().gte(0),
  text: z.string(),
  status: TRANSCRIPT_SEGMENT_STATUS_SCHEMA,
  speakerId: z.string().optional(),
  recordedAt: ISO_DATETIME_SCHEMA,
});
export type SegmentRevisionRecord = z.infer<
  typeof SEGMENT_REVISION_RECORD_SCHEMA
>;

/** Speech → claim → document/excerpt → conclusion link of the export. */
export const SESSION_EXPORT_LINK_SCHEMA = z.object({
  segmentRefs: z.array(REVISION_REF_SCHEMA),
  originalQuote: z.string(),
  speakerId: z.string().optional(),
  claimRef: REVISION_REF_SCHEMA,
  normalizedClaim: z.string(),
  verificationId: z.string(),
  verificationRevision: z.number().int().gte(0),
  current: z.boolean(),
  status: CLAIM_STATUS_SCHEMA,
  verdict: VERDICT_SCHEMA.optional(),
  conclusion: z.string().optional(),
  evidence: z.array(
    z.object({
      evidenceId: z.string(),
      relation: EVIDENCE_RELATION_SCHEMA,
      excerpt: z.string(),
      location: z.string().optional(),
      verifiedContent: z.boolean(),
      sourceId: z.string(),
      sourceUrl: z.string(),
      sourceTitle: z.string(),
    }),
  ),
});
export type SessionExportLink = z.infer<typeof SESSION_EXPORT_LINK_SCHEMA>;

// ===== Envelope =====
export const EVENT_ENVELOPE_SCHEMA = z.object({
  protocolVersion: z.number(),
  eventId: z.string().min(1),
  sessionId: z.string().optional(),
  eventSeq: z.number().int().gte(0),
  emittedAt: ISO_DATETIME_SCHEMA,
});
export type EventEnvelope = z.infer<typeof EVENT_ENVELOPE_SCHEMA>;

// Server -> client events travel as { envelope, data }; client -> server
// payloads are sent as-is (the server stamps the envelope on emission).
const envelopeEvent = <T extends z.ZodType>(data: T) =>
  z.object({ envelope: EVENT_ENVELOPE_SCHEMA, data });

// ===== Cliente -> servidor =====
export const START_LIVE_SESSION_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
  source: z.enum(['TAB', 'MIC']),
  language: z.literal('pt-BR'),
  consent: z.literal(true),
  apiKeys: z
    .object({
      google: z.string().max(LIVE_PAYLOAD_LIMITS.maxApiKeyChars).optional(),
      tavily: z.string().max(LIVE_PAYLOAD_LIMITS.maxApiKeyChars).optional(),
    })
    .optional(),
});
export type StartLiveSession = z.infer<typeof START_LIVE_SESSION_SCHEMA>;

export const AUDIO_CHUNK_SCHEMA = AUDIO_CHUNK_META_SCHEMA.extend({
  sessionId: LIVE_ID_SCHEMA,
});
export type AudioChunk = z.infer<typeof AUDIO_CHUNK_SCHEMA>;

export const LIVE_SESSION_CONTROL_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
});
export type LiveSessionControl = z.infer<typeof LIVE_SESSION_CONTROL_SCHEMA>;

export const RESUME_SESSION_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
  cursor: z.number().int().gte(0),
  /**
   * Capability issued in `LIVE_SESSION_STARTED`. Required by the server to
   * reclaim a session from another socket: knowing the sessionId is not
   * authorization (LIVE-038).
   */
  resumeToken: z
    .string()
    .min(1)
    .max(LIVE_PAYLOAD_LIMITS.maxResumeTokenChars)
    .optional(),
});
export type ResumeSession = z.infer<typeof RESUME_SESSION_SCHEMA>;

export const UPDATE_SPEAKER_MAPPING_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
  mappings: z
    .array(
      SPEAKER_MAPPING_SCHEMA.extend({
        speakerId: LIVE_ID_SCHEMA,
        participantName: z
          .string()
          .min(1)
          .max(LIVE_PAYLOAD_LIMITS.maxParticipantNameChars),
      }),
    )
    .max(LIVE_PAYLOAD_LIMITS.maxSpeakerMappings),
  expectedRevision: z.number().int().gte(0),
});
export type UpdateSpeakerMapping = z.infer<
  typeof UPDATE_SPEAKER_MAPPING_SCHEMA
>;

export const CORRECT_TRANSCRIPT_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
  segmentId: LIVE_ID_SCHEMA,
  expectedRevision: z.number().int().gte(0),
  text: z.string().min(1).max(LIVE_PAYLOAD_LIMITS.maxCorrectionChars),
});
export type CorrectTranscript = z.infer<typeof CORRECT_TRANSCRIPT_SCHEMA>;

export const RETRY_VERIFICATION_SCHEMA = z.object({
  verificationId: LIVE_ID_SCHEMA,
});
export type RetryVerification = z.infer<typeof RETRY_VERIFICATION_SCHEMA>;

export const EXPORT_SESSION_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
});
export type ExportSession = z.infer<typeof EXPORT_SESSION_SCHEMA>;

export const DELETE_SESSION_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
});
export type DeleteSession = z.infer<typeof DELETE_SESSION_SCHEMA>;

/**
 * Human review of the *current* verification revision (LIVE-040). Stored as a
 * record distinct from automated checks; it never changes the verdict and is
 * rejected when `expectedRevision` is stale.
 */
export const SUBMIT_HUMAN_REVIEW_SCHEMA = z.object({
  sessionId: LIVE_ID_SCHEMA,
  verificationId: LIVE_ID_SCHEMA,
  expectedRevision: z.number().int().gte(0),
  decision: HUMAN_REVIEW_DECISION_SCHEMA,
  note: z.string().max(LIVE_PAYLOAD_LIMITS.maxReviewNoteChars).optional(),
});
export type SubmitHumanReview = z.infer<typeof SUBMIT_HUMAN_REVIEW_SCHEMA>;

export const CLIENT_EVENT_SCHEMAS = {
  START_LIVE_SESSION: START_LIVE_SESSION_SCHEMA,
  AUDIO_CHUNK: AUDIO_CHUNK_SCHEMA,
  PAUSE_LIVE_SESSION: LIVE_SESSION_CONTROL_SCHEMA,
  RESUME_LIVE_SESSION: LIVE_SESSION_CONTROL_SCHEMA,
  END_LIVE_SESSION: LIVE_SESSION_CONTROL_SCHEMA,
  CANCEL_LIVE_SESSION: LIVE_SESSION_CONTROL_SCHEMA,
  RESUME_SESSION: RESUME_SESSION_SCHEMA,
  UPDATE_SPEAKER_MAPPING: UPDATE_SPEAKER_MAPPING_SCHEMA,
  CORRECT_TRANSCRIPT: CORRECT_TRANSCRIPT_SCHEMA,
  RETRY_VERIFICATION: RETRY_VERIFICATION_SCHEMA,
  EXPORT_SESSION: EXPORT_SESSION_SCHEMA,
  DELETE_SESSION: DELETE_SESSION_SCHEMA,
  SUBMIT_HUMAN_REVIEW: SUBMIT_HUMAN_REVIEW_SCHEMA,
} as const;

// ===== Servidor -> cliente =====
export const LIVE_SESSION_STARTED_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  state: LIVE_SESSION_STATE_SCHEMA,
  /**
   * Per-session capability for `RESUME_SESSION` from a new socket. Sent only
   * to the owner; never included in snapshots, exports, logs or metrics.
   */
  resumeToken: z.string().min(1).optional(),
});
export const LIVE_SESSION_STARTED_EVENT_SCHEMA = envelopeEvent(
  LIVE_SESSION_STARTED_DATA_SCHEMA,
);
export type LiveSessionStartedData = z.infer<
  typeof LIVE_SESSION_STARTED_DATA_SCHEMA
>;
export type LiveSessionStartedEvent = z.infer<
  typeof LIVE_SESSION_STARTED_EVENT_SCHEMA
>;

export const LIVE_SESSION_STATE_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  state: LIVE_SESSION_STATE_SCHEMA,
  reason: z.string().optional(),
});
export const LIVE_SESSION_STATE_EVENT_SCHEMA = envelopeEvent(
  LIVE_SESSION_STATE_DATA_SCHEMA,
);
export type LiveSessionStateData = z.infer<
  typeof LIVE_SESSION_STATE_DATA_SCHEMA
>;
export type LiveSessionStateEvent = z.infer<
  typeof LIVE_SESSION_STATE_EVENT_SCHEMA
>;

export const TRANSCRIPT_EVENT_DATA_SCHEMA = z.object({
  segment: TRANSCRIPT_SEGMENT_SCHEMA,
});
export const TRANSCRIPT_PARTIAL_EVENT_SCHEMA = envelopeEvent(
  TRANSCRIPT_EVENT_DATA_SCHEMA,
);
export const TRANSCRIPT_FINAL_EVENT_SCHEMA = envelopeEvent(
  TRANSCRIPT_EVENT_DATA_SCHEMA,
);
export const TRANSCRIPT_REVISED_EVENT_SCHEMA = envelopeEvent(
  TRANSCRIPT_EVENT_DATA_SCHEMA,
);
export type TranscriptEventData = z.infer<typeof TRANSCRIPT_EVENT_DATA_SCHEMA>;
export type TranscriptPartialEvent = z.infer<
  typeof TRANSCRIPT_PARTIAL_EVENT_SCHEMA
>;
export type TranscriptFinalEvent = z.infer<
  typeof TRANSCRIPT_FINAL_EVENT_SCHEMA
>;
export type TranscriptRevisedEvent = z.infer<
  typeof TRANSCRIPT_REVISED_EVENT_SCHEMA
>;

export const SPEAKER_MAPPING_UPDATED_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  mappings: z.array(SPEAKER_MAPPING_SCHEMA),
  revision: z.number().int().gte(0),
});
export const SPEAKER_MAPPING_UPDATED_EVENT_SCHEMA = envelopeEvent(
  SPEAKER_MAPPING_UPDATED_DATA_SCHEMA,
);
export type SpeakerMappingUpdatedData = z.infer<
  typeof SPEAKER_MAPPING_UPDATED_DATA_SCHEMA
>;
export type SpeakerMappingUpdatedEvent = z.infer<
  typeof SPEAKER_MAPPING_UPDATED_EVENT_SCHEMA
>;

export const CLAIM_DETECTED_DATA_SCHEMA = z.object({
  claim: CLAIM_SCHEMA,
});
export const CLAIM_DETECTED_EVENT_SCHEMA = envelopeEvent(
  CLAIM_DETECTED_DATA_SCHEMA,
);
export type ClaimDetectedData = z.infer<typeof CLAIM_DETECTED_DATA_SCHEMA>;
export type ClaimDetectedEvent = z.infer<typeof CLAIM_DETECTED_EVENT_SCHEMA>;

export const CLAIM_STATUS_UPDATED_DATA_SCHEMA = z.object({
  claimId: z.string(),
  status: CLAIM_STATUS_SCHEMA,
  revision: z.number().int().gte(0),
});
export const CLAIM_STATUS_UPDATED_EVENT_SCHEMA = envelopeEvent(
  CLAIM_STATUS_UPDATED_DATA_SCHEMA,
);
export type ClaimStatusUpdatedData = z.infer<
  typeof CLAIM_STATUS_UPDATED_DATA_SCHEMA
>;
export type ClaimStatusUpdatedEvent = z.infer<
  typeof CLAIM_STATUS_UPDATED_EVENT_SCHEMA
>;

export const VERIFICATION_RESULT_DATA_SCHEMA = z.object({
  verification: VERIFICATION_SCHEMA,
});
export const VERIFICATION_RESULT_EVENT_SCHEMA = envelopeEvent(
  VERIFICATION_RESULT_DATA_SCHEMA,
);
export type VerificationResultData = z.infer<
  typeof VERIFICATION_RESULT_DATA_SCHEMA
>;
export type VerificationResultEvent = z.infer<
  typeof VERIFICATION_RESULT_EVENT_SCHEMA
>;

export const VERIFICATION_INVALIDATED_DATA_SCHEMA = z.object({
  verificationId: z.string(),
  reason: z.string(),
  revision: z.number().int().gte(0),
  // Additive audit fields (LIVE-040).
  claimId: z.string().optional(),
  cause: INVALIDATION_CAUSE_SCHEMA.optional(),
  invalidatedAt: ISO_DATETIME_SCHEMA.optional(),
  attemptId: z.string().optional(),
  previousVerdict: VERDICT_SCHEMA.optional(),
  diff: REVISION_DIFF_SCHEMA.optional(),
});
export const VERIFICATION_INVALIDATED_EVENT_SCHEMA = envelopeEvent(
  VERIFICATION_INVALIDATED_DATA_SCHEMA,
);
export type VerificationInvalidatedData = z.infer<
  typeof VERIFICATION_INVALIDATED_DATA_SCHEMA
>;
export type VerificationInvalidatedEvent = z.infer<
  typeof VERIFICATION_INVALIDATED_EVENT_SCHEMA
>;

export const SESSION_SNAPSHOT_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  state: LIVE_SESSION_STATE_SCHEMA,
  segments: z.array(TRANSCRIPT_SEGMENT_SCHEMA),
  claims: z.array(CLAIM_SCHEMA),
  verifications: z.array(VERIFICATION_SCHEMA),
  cursor: z.number().int().gte(0),
  /**
   * Latest invalidation per verification id (LIVE-040). Replaying a snapshot
   * must apply these so an old verdict is never resurrected.
   */
  invalidations: z.array(VERIFICATION_INVALIDATION_RECORD_SCHEMA).optional(),
});
export const SESSION_SNAPSHOT_EVENT_SCHEMA = envelopeEvent(
  SESSION_SNAPSHOT_DATA_SCHEMA,
);
export type SessionSnapshotData = z.infer<typeof SESSION_SNAPSHOT_DATA_SCHEMA>;
export type SessionSnapshotEvent = z.infer<
  typeof SESSION_SNAPSHOT_EVENT_SCHEMA
>;

export const LIVE_METRICS_DATA_SCHEMA = z.object({
  sessionId: z.string().optional(),
  stage: z.string(),
  latencyMs: z.number(),
  queueDepth: z.number(),
  deferred: z.number(),
  creditsUsed: z.number().optional(),
});
export const LIVE_METRICS_EVENT_SCHEMA = envelopeEvent(
  LIVE_METRICS_DATA_SCHEMA,
);
export type LiveMetricsData = z.infer<typeof LIVE_METRICS_DATA_SCHEMA>;
export type LiveMetricsEvent = z.infer<typeof LIVE_METRICS_EVENT_SCHEMA>;

export const LIVE_GAP_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  fromSample: z.number().int(),
  toSample: z.number().int(),
  reason: z.string(),
});
export const LIVE_GAP_EVENT_SCHEMA = envelopeEvent(LIVE_GAP_DATA_SCHEMA);
export type LiveGapData = z.infer<typeof LIVE_GAP_DATA_SCHEMA>;
export type LiveGapEvent = z.infer<typeof LIVE_GAP_EVENT_SCHEMA>;

export const LIVE_SESSION_ENDED_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  reason: z.string(),
});
export const LIVE_SESSION_ENDED_EVENT_SCHEMA = envelopeEvent(
  LIVE_SESSION_ENDED_DATA_SCHEMA,
);
export type LiveSessionEndedData = z.infer<
  typeof LIVE_SESSION_ENDED_DATA_SCHEMA
>;
export type LiveSessionEndedEvent = z.infer<
  typeof LIVE_SESSION_ENDED_EVENT_SCHEMA
>;

export const SESSION_EXPORT_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  exportedAt: ISO_DATETIME_SCHEMA,
  state: LIVE_SESSION_STATE_SCHEMA,
  retention: LIVE_RETENTION_POLICY_SCHEMA,
  /** What is deliberately left out of the default export. */
  excludes: z.array(z.enum(['AUDIO', 'CREDENTIALS', 'VOICE_EMBEDDINGS'])),
  segments: z.array(TRANSCRIPT_SEGMENT_SCHEMA),
  segmentHistory: z.array(SEGMENT_REVISION_RECORD_SCHEMA),
  claims: z.array(CLAIM_SCHEMA),
  supersededClaims: z.array(CLAIM_SCHEMA),
  verifications: z.array(VERIFICATION_SCHEMA),
  supersededVerifications: z.array(VERIFICATION_SHAPE_SCHEMA),
  links: z.array(SESSION_EXPORT_LINK_SCHEMA),
  audit: SESSION_AUDIT_SCHEMA,
});
export const SESSION_EXPORT_EVENT_SCHEMA = envelopeEvent(
  SESSION_EXPORT_DATA_SCHEMA,
);
export type SessionExportData = z.infer<typeof SESSION_EXPORT_DATA_SCHEMA>;
export type SessionExportEvent = z.infer<typeof SESSION_EXPORT_EVENT_SCHEMA>;

export const HUMAN_REVIEW_RECORDED_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  review: HUMAN_REVIEW_RECORD_SCHEMA,
});
export const HUMAN_REVIEW_RECORDED_EVENT_SCHEMA = envelopeEvent(
  HUMAN_REVIEW_RECORDED_DATA_SCHEMA,
);
export type HumanReviewRecordedData = z.infer<
  typeof HUMAN_REVIEW_RECORDED_DATA_SCHEMA
>;
export type HumanReviewRecordedEvent = z.infer<
  typeof HUMAN_REVIEW_RECORDED_EVENT_SCHEMA
>;

export const AUDIO_CHUNK_ACK_DATA_SCHEMA = z.object({
  sessionId: z.string(),
  chunkSeq: z.number().int(),
  accepted: z.boolean(),
});
export const AUDIO_CHUNK_ACK_EVENT_SCHEMA = envelopeEvent(
  AUDIO_CHUNK_ACK_DATA_SCHEMA,
);
export type AudioChunkAckData = z.infer<typeof AUDIO_CHUNK_ACK_DATA_SCHEMA>;
export type AudioChunkAckEvent = z.infer<typeof AUDIO_CHUNK_ACK_EVENT_SCHEMA>;

export const SERVER_EVENT_SCHEMAS = {
  LIVE_SESSION_STARTED: LIVE_SESSION_STARTED_EVENT_SCHEMA,
  LIVE_SESSION_STATE: LIVE_SESSION_STATE_EVENT_SCHEMA,
  TRANSCRIPT_PARTIAL: TRANSCRIPT_PARTIAL_EVENT_SCHEMA,
  TRANSCRIPT_FINAL: TRANSCRIPT_FINAL_EVENT_SCHEMA,
  TRANSCRIPT_REVISED: TRANSCRIPT_REVISED_EVENT_SCHEMA,
  SPEAKER_MAPPING_UPDATED: SPEAKER_MAPPING_UPDATED_EVENT_SCHEMA,
  CLAIM_DETECTED: CLAIM_DETECTED_EVENT_SCHEMA,
  CLAIM_STATUS_UPDATED: CLAIM_STATUS_UPDATED_EVENT_SCHEMA,
  VERIFICATION_RESULT: VERIFICATION_RESULT_EVENT_SCHEMA,
  VERIFICATION_INVALIDATED: VERIFICATION_INVALIDATED_EVENT_SCHEMA,
  SESSION_SNAPSHOT: SESSION_SNAPSHOT_EVENT_SCHEMA,
  LIVE_METRICS: LIVE_METRICS_EVENT_SCHEMA,
  LIVE_GAP: LIVE_GAP_EVENT_SCHEMA,
  LIVE_SESSION_ENDED: LIVE_SESSION_ENDED_EVENT_SCHEMA,
  AUDIO_CHUNK_ACK: AUDIO_CHUNK_ACK_EVENT_SCHEMA,
  SESSION_EXPORT: SESSION_EXPORT_EVENT_SCHEMA,
  HUMAN_REVIEW_RECORDED: HUMAN_REVIEW_RECORDED_EVENT_SCHEMA,
} as const;
