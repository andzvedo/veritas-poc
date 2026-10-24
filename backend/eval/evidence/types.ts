import { VERDICT_SCHEMA } from '@veritas/shared';
import { z } from 'zod';

/**
 * Review annotations for evidence + verdict evaluation (LIVE-035).
 *
 * `AUTHOR_ANNOTATION` = written by whoever authored the fixture (regression
 * only). `INDEPENDENT_HUMAN` = a reviewer who did not write the fixture nor
 * the pipeline output. Only the latter counts toward readiness.
 */

export const PROPOSITION_TYPE_SCHEMA = z.enum([
  'ORIGIN_ATTRIBUTION',
  'NUMERIC_VALUE',
  'TEMPORAL_SCOPE',
  'AGGREGATE_ATTRIBUTION',
  'STATISTICAL_TREND',
  'OPERATIONAL',
]);

export const CORRECTION_KIND_SCHEMA = z.enum([
  /** The pipeline output contradicts the documents: a real error. */
  'FACTUAL_ERROR',
  /** Reasonable reviewers disagree on framing; not counted as an error. */
  'INTERPRETIVE_DIVERGENCE',
]);

export const REVIEW_SCHEMA = z.object({
  reviewerId: z.string().min(1),
  reviewerKind: z.enum(['AUTHOR_ANNOTATION', 'INDEPENDENT_HUMAN']),
  reviewedAt: z.string().min(1),
  evidence: z
    .array(
      z.object({
        evidenceId: z.string().min(1),
        pertinent: z.boolean(),
        excerptFaithful: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  /** Evidence suffices for the conclusion (null when not applicable). */
  sufficient: z.boolean().nullable(),
  /** Conclusion follows from the cited proof (null when not applicable). */
  conclusionCoherent: z.boolean().nullable(),
  /** Reviewer verdict when it differs from the pipeline output. */
  correction: z
    .object({
      from: VERDICT_SCHEMA,
      to: VERDICT_SCHEMA,
      kind: CORRECTION_KIND_SCHEMA,
      reason: z.string().min(1),
      applied: z.boolean().default(false),
    })
    .optional(),
  notes: z.string().optional(),
});
export type Review = z.infer<typeof REVIEW_SCHEMA>;

export const CASE_ANNOTATION_SCHEMA = z.object({
  caseId: z.string().min(1),
  propositionType: PROPOSITION_TYPE_SCHEMA,
  reviews: z.array(REVIEW_SCHEMA).default([]),
});
export type CaseAnnotation = z.infer<typeof CASE_ANNOTATION_SCHEMA>;

export const ANNOTATIONS_FILE_SCHEMA = z.array(CASE_ANNOTATION_SCHEMA);
