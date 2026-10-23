import type { FactCheckResult, Verdict } from '@veritas/shared';
import type { ResultData, VerificationOutcome } from '../types/results.js';

/**
 * Maps the migrated text-mode contract to the legacy ResultsPanel shape.
 *
 * LIVE-017: never treat "absence of MISLEADING" as verified. Prefer
 * `verification.verdict` when present; fall back to explicit legacy flags only.
 */
export function verdictToOutcome(verdict: Verdict): VerificationOutcome {
  switch (verdict) {
    case 'SUPPORTED':
      return 'verified';
    case 'FALSE':
    case 'MISLEADING':
      return 'unverified';
    case 'INCONCLUSIVE':
      return 'pending';
    default: {
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}

export function factCheckResultToOutcome(
  result: FactCheckResult,
): VerificationOutcome {
  const verification = result.data.verification;
  if (verification !== undefined) {
    if (verification.status !== 'COMPLETED' || verification.verdict === undefined) {
      return 'pending';
    }
    return verdictToOutcome(verification.verdict);
  }

  const flags = result.data.flags ?? [];
  if (flags.includes('MISLEADING')) {
    return 'unverified';
  }
  if (
    flags.includes('UNVERIFIABLE') ||
    flags.includes('INCONCLUSIVE') ||
    flags.includes('AMBIGUOUS')
  ) {
    return 'pending';
  }

  // Without a structured verification, an empty flag list is NOT proof of
  // support — only an explicit SUPPORTED verification may yield "verified".
  return 'pending';
}

export function factCheckResultToResultData(
  result: FactCheckResult,
): ResultData {
  const verification = result.data.verification;
  const id =
    verification?.id ??
    `${result.meta.fingerprint}-${String(result.meta.chunk)}-${String(result.meta.seq)}`;

  return {
    id,
    text: result.data.extractedClaim,
    confidence: result.data.reasoningConfidence,
    status: factCheckResultToOutcome(result),
    sources: result.data.sources ?? [],
    explanation: result.data.reasoning,
  };
}
