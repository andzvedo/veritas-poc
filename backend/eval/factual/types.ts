import { z } from 'zod';
import {
  EVIDENCE_RELATION_SCHEMA,
  MECHANISM_CODE_SCHEMA,
  SOURCE_TYPE_SCHEMA,
  VERDICT_SCHEMA,
} from '@veritas/shared';

/**
 * Annotated offline factual-eval fixtures (LIVE-024).
 *
 * Editorial labels (`expected.verdict`, mechanisms, etc.) are revisable
 * hypotheses for regression — not answers a model must memorize.
 */

export const FIXTURE_SOURCE_SCHEMA = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  type: SOURCE_TYPE_SCHEMA,
  /** Frozen corpus document id under eval/factual/corpus/ */
  corpusDocumentId: z.string().min(1).optional(),
  /** Mark secondary/indirect sources that are not primary audits. */
  indirect: z.boolean().default(false),
  /** Official consultation not yet reproduced offline. */
  unreproducedOfficialQuery: z.boolean().default(false),
  publishedAt: z.string().optional(),
  dataPeriod: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});

export const FIXTURE_EVIDENCE_SCHEMA = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  relation: EVIDENCE_RELATION_SCHEMA,
  excerpt: z.string().min(1),
  explanation: z.string().min(1),
  location: z.string().optional(),
  verifiedContent: z.boolean().default(true),
});

export const FIXTURE_EXPECTED_SCHEMA = z.object({
  /** Operational status when not a completed factual verdict. */
  status: z
    .enum(['COMPLETED', 'BLOCKED', 'FAILED', 'DEFERRED', 'CANCELLED'])
    .default('COMPLETED'),
  verdict: VERDICT_SCHEMA.optional(),
  contradictionRequired: z.boolean().default(false),
  expectedMechanismCodes: z.array(MECHANISM_CODE_SCHEMA).default([]),
  /** Aspects that must appear (substring match) when MISLEADING/SUPPORTED. */
  supportedAspectSubstrings: z.array(z.string()).default([]),
  /** Limitation substrings that must appear (e.g. insufficient docs). */
  limitationSubstrings: z.array(z.string()).default([]),
  /** Must preserve literal quote (no editorial “[Lula]” inside). */
  preserveLiteralQuote: z.boolean().default(true),
  /** Editorial annotation kept outside originalQuote. */
  editorialAnnotation: z.string().optional(),
  notes: z.string().optional(),
});

export const FIXTURE_CASE_SCHEMA = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  family: z.enum([
    'pix-origin',
    'auxilio-600',
    'travels',
    'supported-control',
    'inconclusive',
    'operational',
    'multi-proposition',
  ]),
  participant: z.string().min(1),
  originalQuote: z.string().min(1),
  normalizedClaim: z.string().min(1),
  atomicProposition: z.string().min(1),
  transcriptConfirmed: z.boolean().default(true),
  /** Scripted LLM verdict draft for offline synthesis (no paid keys). */
  verdictDraft: z
    .looseObject({
      verdict: VERDICT_SCHEMA,
      conclusion: z.string(),
    })
    .optional(),
  sources: z.array(FIXTURE_SOURCE_SCHEMA).min(0),
  evidence: z.array(FIXTURE_EVIDENCE_SCHEMA).min(0),
  gaps: z.array(z.string()).default([]),
  expected: FIXTURE_EXPECTED_SCHEMA,
  references: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        url: z.url().optional(),
        primary: z.boolean().default(false),
      }),
    )
    .default([]),
});

export type FixtureCase = z.infer<typeof FIXTURE_CASE_SCHEMA>;
export type FixtureExpected = z.infer<typeof FIXTURE_EXPECTED_SCHEMA>;

export type CaseCheckResult = {
  caseId: string;
  family: FixtureCase['family'];
  participant: string;
  passed: boolean;
  checks: {
    name: string;
    ok: boolean;
    detail?: string;
  }[];
};

export type EvalMetrics = {
  /** Cases that passed all checks / total cases. */
  casePassRate: { passed: number; total: number; rate: number };
  /** FALSE cases with documented contradiction / FALSE expected. */
  contradictionCoverage: { hit: number; total: number; rate: number };
  /** MISLEADING cases with expected mechanism codes present. */
  mechanismCoverage: { hit: number; total: number; rate: number };
  /** Operational fixtures that did not invent a factual verdict. */
  operationalSafety: { hit: number; total: number; rate: number };
  /** Per-family pass counts. */
  byFamily: Record<
    string,
    { passed: number; total: number; rate: number }
  >;
  /** Same criteria applied across participants. */
  byParticipant: Record<
    string,
    { passed: number; total: number; rate: number }
  >;
};
