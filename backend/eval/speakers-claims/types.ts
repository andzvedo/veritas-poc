import { z } from 'zod';

/**
 * Annotated dialogue fixtures for speaker + claim evaluation (LIVE-015/034).
 *
 * Three layers are annotated and scored separately:
 * 1. diarization — opaque provider labels per window (`observations`);
 * 2. name association — the manual label → participant mapping;
 * 3. claim extraction — gold claims vs. the scripted/recorded extractor output.
 *
 * `SIMULATED` diarization (hand-written labels over text) never counts as
 * diarization quality: only `RECORDED` output on real audio does (LIVE-000).
 */

export const SPEAKER_OBSERVATION_FIXTURE_SCHEMA = z.object({
  speakerLabel: z.string().min(1),
  confidence: z.number().gte(0).lte(1).optional(),
});

export const EXTRACTED_ENTRY_FIXTURE_SCHEMA = z.looseObject({
  originalQuote: z.string().min(1),
  normalizedClaim: z.string().min(1),
  notFactCheckable: z.boolean().optional(),
});

export const DIALOGUE_SEGMENT_SCHEMA = z.object({
  id: z.string().min(1),
  startMs: z.number().int().gte(0),
  endMs: z.number().int().gte(0),
  text: z.string().min(1),
  /** Reference speaker (participant ref). `null` = not annotatable. */
  refSpeaker: z.string().min(1).nullable(),
  /** Other participants talking at the same time (simultaneous speech). */
  overlapWith: z.array(z.string()).default([]),
  /** Diarization output for this window (empty = no label). */
  observations: z.array(SPEAKER_OBSERVATION_FIXTURE_SCHEMA).default([]),
  /** Extractor output for this segment (scripted LLM JSON array). */
  extraction: z.array(EXTRACTED_ENTRY_FIXTURE_SCHEMA),
  /** Later ASR correction of this segment (context correction). */
  correction: z.object({ text: z.string().min(1) }).optional(),
});
export type DialogueSegment = z.infer<typeof DIALOGUE_SEGMENT_SCHEMA>;

export const GOLD_CLAIM_SCHEMA = z.object({
  id: z.string().min(1),
  segmentId: z.string().min(1),
  /** Participant ref who actually said it. */
  speakerRef: z.string().min(1),
  quote: z.string().min(1),
  kind: z.enum(['CHECKABLE', 'NOT_FACT_CHECKABLE', 'INCOMPLETE']),
  /** Gold id of the first occurrence of the same proposition. */
  duplicateOf: z.string().optional(),
  /** Segments needed to resolve pronouns / references. */
  requiresContextSegmentIds: z.array(z.string()).default([]),
  /** Literal referent that must reach the extractor prompt. */
  requiresContextText: z.string().optional(),
  /** Annotated: claim must be invalidated after the segment corrections. */
  staleAfterCorrection: z.boolean().default(false),
  notes: z.string().optional(),
});
export type GoldClaim = z.infer<typeof GOLD_CLAIM_SCHEMA>;

export const DIALOGUE_FIXTURE_SCHEMA = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  media: z.object({
    kind: z.enum(['TEXT_SIMULATED', 'SYNTHETIC_AUDIO', 'REAL_DEBATE']),
    reference: z.string().min(1),
  }),
  diarizationProvenance: z.enum(['SIMULATED', 'RECORDED', 'NONE']),
  extractionProvenance: z.enum(['SCRIPTED', 'RECORDED']),
  contextMaxSegments: z.number().int().positive().optional(),
  participants: z
    .array(
      z.object({
        ref: z.string().min(1),
        name: z.string().min(1),
        role: z.enum(['PARTICIPANT', 'MEDIATOR']),
      }),
    )
    .min(1),
  /** Manual mapping performed by the operator (may be unconfirmed). */
  mapping: z
    .array(
      z.object({
        speakerLabel: z.string().min(1),
        participantRef: z.string().min(1),
        confirmed: z.boolean(),
      }),
    )
    .default([]),
  segments: z.array(DIALOGUE_SEGMENT_SCHEMA).min(1),
  goldClaims: z.array(GOLD_CLAIM_SCHEMA),
});
export type DialogueFixture = z.infer<typeof DIALOGUE_FIXTURE_SCHEMA>;
