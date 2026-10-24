import { z } from 'zod';

/**
 * Annotated transcription-eval fixtures (LIVE-033).
 *
 * Each fixture pairs a human reference transcript with a hypothesis. Offline
 * fixtures carry *simulated* hypotheses (hand-written, with realistic ASR
 * errors) — they validate the measurement tool, never the model. Real
 * whisper.cpp outputs recorded on the LIVE-000 machine are plugged in with
 * `--hypotheses <dir>` and are reported separately.
 */

export const CRITICAL_CATEGORY_SCHEMA = z.enum([
  'PROPER_NAME',
  'NUMBER',
  'DATE',
  'PERCENT',
  'UNIT',
  'NEGATION',
]);
export type CriticalCategory = z.infer<typeof CRITICAL_CATEGORY_SCHEMA>;

export const MEDIA_KIND_SCHEMA = z.enum([
  /** Text-only fixture: no audio exists. Never evidence of model quality. */
  'TEXT_SIMULATED',
  /** Synthetic audio (TTS / mixed noise). Not a real debate. */
  'SYNTHETIC_AUDIO',
  /** Real recorded debate audio (LIVE-000 corpus). */
  'REAL_DEBATE',
]);

export const CRITICAL_TERM_SCHEMA = z.object({
  /** Canonical surface form in the reference. */
  text: z.string().min(1),
  category: CRITICAL_CATEGORY_SCHEMA,
  /** Accepted equivalent spellings in a hypothesis (e.g. "seiscentos"). */
  accept: z.array(z.string().min(1)).default([]),
});
export type CriticalTerm = z.infer<typeof CRITICAL_TERM_SCHEMA>;

export const TRANSCRIPTION_FIXTURE_SCHEMA = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** `CORPUS` counts toward gates; `CONTROL` must trip them (sensitivity). */
  role: z.enum(['CORPUS', 'CONTROL']),
  condition: z.enum(['CLEAN', 'NOISE', 'INTERRUPTION', 'OVERLAP']),
  media: z.object({
    kind: MEDIA_KIND_SCHEMA,
    /** Media reference (URL, file name or "n/a" for text-only fixtures). */
    reference: z.string().min(1),
    /** Media offset of the evaluated window. */
    offsetMs: z.number().int().gte(0),
    durationMs: z.number().int().positive(),
    window: z.object({
      sizeMs: z.number().int().positive(),
      overlapMs: z.number().int().gte(0),
    }),
  }),
  reference: z.object({
    text: z.string().min(1),
    criticalTerms: z.array(CRITICAL_TERM_SCHEMA).default([]),
    annotator: z.string().min(1),
  }),
  hypothesis: z.object({
    provenance: z.enum(['SIMULATED', 'RECORDED']),
    text: z.string(),
    model: z.string().min(1),
    hardware: z.string().min(1),
    /** Wall-clock processing time of the window, when measured. */
    processingMs: z.number().gte(0).optional(),
  }),
  expected: z.object({
    /**
     * Critical errors the harness must detect, as `CATEGORY:term`. Used as a
     * self-check of the measurement tool, not as a quality target.
     */
    criticalErrors: z.array(z.string()).default([]),
  }),
  notes: z.string().optional(),
});
export type TranscriptionFixture = z.infer<typeof TRANSCRIPTION_FIXTURE_SCHEMA>;

/** Sidecar metadata for a recorded whisper.cpp hypothesis (`<id>.meta.json`). */
export const RECORDED_META_SCHEMA = z.object({
  model: z.string().min(1),
  hardware: z.string().min(1),
  processingMs: z.number().gte(0).optional(),
  mediaKind: MEDIA_KIND_SCHEMA.optional(),
});
