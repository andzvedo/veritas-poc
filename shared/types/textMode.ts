import { z } from 'zod';
import {
  VERIFICATION_SCHEMA,
  type Claim,
  type Verdict,
  type Verification,
} from './live.js';

/**
 * Text-mode contract migration (LIVE-001 / LIVE-016).
 *
 * The wire event remains `FACT_CHECK_RESULT` so the manual UI keeps working.
 * New clients must prefer `data.verification` (normative §10 contract). Legacy
 * fields (`extractedClaim`, `reasoning`, `flags`, `sources`,
 * `reasoningConfidence`) are derived projections and MUST NOT gate research or
 * be read as authoritative factual proof.
 *
 * `researchThreshold` on the request is accepted for backward compatibility and
 * ignored by the evidence engine.
 */

/** Bump when the text-mode result shape changes in a breaking way. */
export const TEXT_MODE_RESULT_VERSION = 1;

export const LEGACY_FACT_CHECK_FLAG_SCHEMA = z.enum([
  'UNVERIFIABLE',
  'MISLEADING',
  'INCONCLUSIVE',
  'AMBIGUOUS',
]);
export type LegacyFactCheckFlag = z.infer<typeof LEGACY_FACT_CHECK_FLAG_SCHEMA>;

/**
 * Extended text-mode result payload. Legacy fields stay required so older UI
 * keeps parsing; `verification` carries the structured contract when an
 * investigation (or explicit triage) was produced.
 */
export const TEXT_MODE_FACT_CHECK_RESULT_DATA_SCHEMA = z.object({
  extractedClaim: z.string(),
  /**
   * Deprecated compatibility score. Never used to decide whether to research.
   * Prefer `verification` status/verdict/evidence.
   */
  reasoningConfidence: z.number().gte(0).lte(1),
  reasoning: z.string().min(1, 'Reasoning cannot be empty'),
  flags: z.array(LEGACY_FACT_CHECK_FLAG_SCHEMA).optional(),
  /** Legacy URL list; structured sources live under `verification.sources`. */
  sources: z.array(z.url()).optional(),
  verification: VERIFICATION_SCHEMA.optional(),
  resultVersion: z.literal(TEXT_MODE_RESULT_VERSION).optional(),
});
export type TextModeFactCheckResultData = z.infer<
  typeof TEXT_MODE_FACT_CHECK_RESULT_DATA_SCHEMA
>;

export function verdictToLegacyFlags(
  verdict: Verdict | undefined,
): LegacyFactCheckFlag[] | undefined {
  switch (verdict) {
    case 'MISLEADING':
      return ['MISLEADING'];
    case 'INCONCLUSIVE':
      return ['INCONCLUSIVE'];
    case 'FALSE':
    case 'SUPPORTED':
      return undefined;
    case undefined:
      return ['INCONCLUSIVE'];
    default: {
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}

/**
 * Compatibility confidence only. Research must not read this value.
 * Definitive evidence-backed verdicts map high; everything else stays low so
 * the UI does not treat absence of a flag as high certainty.
 */
export function legacyConfidenceForVerification(
  verification: Verification,
): number {
  if (verification.status !== 'COMPLETED' || verification.verdict === undefined) {
    return 0;
  }
  const hasVerifiedEvidence = verification.evidence.some(
    (item) => item.verifiedContent,
  );
  switch (verification.verdict) {
    case 'SUPPORTED':
    case 'FALSE':
    case 'MISLEADING':
      return hasVerifiedEvidence ? 0.9 : 0;
    case 'INCONCLUSIVE':
      return 0.25;
    default: {
      const _exhaustive: never = verification.verdict;
      return _exhaustive;
    }
  }
}

function joinNonEmpty(parts: readonly (string | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
}

/**
 * Projects a normative `Verification` into the legacy text-mode fields.
 * Structural validation of `verification` is assumed (callers parse with
 * VERIFICATION_SCHEMA); this helper does not prove factual correctness.
 */
export function verificationToLegacyFactCheckData(
  verification: Verification,
): TextModeFactCheckResultData {
  const reasoning =
    joinNonEmpty([
      verification.conclusion,
      verification.contradiction,
      ...verification.limitations,
    ]) || 'Investigação registrada sem conclusão textual.';

  const flags =
    verification.status === 'COMPLETED'
      ? verdictToLegacyFlags(verification.verdict)
      : (['INCONCLUSIVE'] as LegacyFactCheckFlag[]);

  return TEXT_MODE_FACT_CHECK_RESULT_DATA_SCHEMA.parse({
    extractedClaim: verification.normalizedClaim,
    reasoningConfidence: legacyConfidenceForVerification(verification),
    reasoning,
    ...(flags !== undefined ? { flags } : {}),
    sources: verification.sources.map((source) => source.url),
    verification,
    resultVersion: TEXT_MODE_RESULT_VERSION,
  });
}

/** Triage-only result: opinion/rhetoric never becomes a verification attempt. */
export function notFactCheckableToLegacyFactCheckData(
  claim: Claim,
): TextModeFactCheckResultData {
  return TEXT_MODE_FACT_CHECK_RESULT_DATA_SCHEMA.parse({
    extractedClaim: claim.normalizedClaim,
    reasoningConfidence: 0,
    reasoning:
      'Afirmação marcada como não verificável documentalmente (opinião, promessa, pergunta ou retórica). Nenhuma investigação foi aberta.',
    flags: ['UNVERIFIABLE'],
    sources: [],
    resultVersion: TEXT_MODE_RESULT_VERSION,
  });
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\btvly-[A-Za-z0-9_-]+/g,
  /\bAIza[0-9A-Za-z_-]+/g,
  /\bAQ\.[0-9A-Za-z_-]+/g,
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  /\b(api[_-]?key|token|secret)\b\s*[:=]\s*["']?[A-Za-z0-9_\-.]{4,}["']?/gi,
];

/**
 * Snapshot/export sanitizer for text-mode results: strips credential-like
 * strings. Never includes raw audio (text mode has none).
 */
export function sanitizeTextModeResultForExport(
  data: TextModeFactCheckResultData,
): TextModeFactCheckResultData {
  const scrub = (value: string): string =>
    SECRET_PATTERNS.reduce(
      (acc, pattern) => acc.replace(pattern, '[redacted]'),
      value,
    );

  const verification =
    data.verification === undefined
      ? undefined
      : {
          ...data.verification,
          conclusion:
            data.verification.conclusion === undefined
              ? undefined
              : scrub(data.verification.conclusion),
          contradiction:
            data.verification.contradiction === undefined
              ? undefined
              : scrub(data.verification.contradiction),
          limitations: data.verification.limitations.map(scrub),
          evidence: data.verification.evidence.map((item) => ({
            ...item,
            excerpt: scrub(item.excerpt),
            explanation: scrub(item.explanation),
          })),
        };

  return TEXT_MODE_FACT_CHECK_RESULT_DATA_SCHEMA.parse({
    ...data,
    reasoning: scrub(data.reasoning),
    ...(verification === undefined ? {} : { verification }),
  });
}
