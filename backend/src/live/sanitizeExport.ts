/**
 * Sanitizes live session snapshots/exports: strip credential-like strings and
 * never include raw audio or API keys (LIVE-006 P0 export).
 */
import { redactSecretText } from '#/utils/security.js';
import type {
  Claim,
  RevisionDiff,
  SessionAudit,
  SessionSnapshotData,
  TranscriptSegment,
  Verification,
  VerificationInvalidationRecord,
} from '@veritas/shared';

/** Credential scrubbing without the log length cap (full text is kept). */
const scrub = (value: string): string => redactSecretText(value);

export function scrubSegment(segment: TranscriptSegment): TranscriptSegment {
  return {
    ...segment,
    text: scrub(segment.text),
  };
}

export function scrubClaim(claim: Claim): Claim {
  return {
    ...claim,
    originalQuote: scrub(claim.originalQuote),
    normalizedClaim: scrub(claim.normalizedClaim),
    atomicClaims: claim.atomicClaims.map((atomic) => ({
      ...atomic,
      proposition: scrub(atomic.proposition),
      ...(atomic.subject === undefined
        ? {}
        : { subject: scrub(atomic.subject) }),
      ...(atomic.predicate === undefined
        ? {}
        : { predicate: scrub(atomic.predicate) }),
      ...(atomic.populationOrScope === undefined
        ? {}
        : { populationOrScope: scrub(atomic.populationOrScope) }),
    })),
  };
}

export function scrubVerification(verification: Verification): Verification {
  return {
    ...verification,
    originalQuote: scrub(verification.originalQuote),
    normalizedClaim: scrub(verification.normalizedClaim),
    ...(verification.conclusion === undefined
      ? {}
      : { conclusion: scrub(verification.conclusion) }),
    ...(verification.contradiction === undefined
      ? {}
      : { contradiction: scrub(verification.contradiction) }),
    limitations: verification.limitations.map(scrub),
    supportedAspects: verification.supportedAspects.map(scrub),
    mechanisms: verification.mechanisms.map((mechanism) => ({
      ...mechanism,
      explanation: scrub(mechanism.explanation),
    })),
    evidence: verification.evidence.map((item) => ({
      ...item,
      excerpt: scrub(item.excerpt),
      explanation: scrub(item.explanation),
    })),
    sources: verification.sources.map((source) => ({
      ...source,
      title: scrub(source.title),
      publisher: scrub(source.publisher),
    })),
    atomicClaim: {
      ...verification.atomicClaim,
      proposition: scrub(verification.atomicClaim.proposition),
      ...(verification.atomicClaim.subject === undefined
        ? {}
        : { subject: scrub(verification.atomicClaim.subject) }),
      ...(verification.atomicClaim.predicate === undefined
        ? {}
        : { predicate: scrub(verification.atomicClaim.predicate) }),
      ...(verification.atomicClaim.populationOrScope === undefined
        ? {}
        : {
            populationOrScope: scrub(
              verification.atomicClaim.populationOrScope,
            ),
          }),
    },
  };
}

export function scrubDiff(diff: RevisionDiff): RevisionDiff {
  return {
    ...diff,
    ...(diff.before === undefined ? {} : { before: scrub(diff.before) }),
    ...(diff.after === undefined ? {} : { after: scrub(diff.after) }),
    changeKinds: [...diff.changeKinds],
  };
}

export function scrubInvalidation(
  record: VerificationInvalidationRecord,
): VerificationInvalidationRecord {
  return {
    ...record,
    reason: scrub(record.reason),
    ...(record.diff === undefined ? {} : { diff: scrubDiff(record.diff) }),
  };
}

export function scrubAudit(audit: SessionAudit): SessionAudit {
  return {
    attempts: audit.attempts.map((attempt) => ({
      ...attempt,
      ...(attempt.reason === undefined ? {} : { reason: scrub(attempt.reason) }),
      inputs: {
        ...attempt.inputs,
        ...(attempt.inputs.speakerName === undefined
          ? {}
          : { speakerName: scrub(attempt.inputs.speakerName) }),
      },
    })),
    invalidations: audit.invalidations.map(scrubInvalidation),
    humanReviews: audit.humanReviews.map((review) => ({
      ...review,
      ...(review.note === undefined ? {} : { note: scrub(review.note) }),
    })),
    typographicCorrections: audit.typographicCorrections.map((record) => ({
      ...record,
      diff: scrubDiff(record.diff),
    })),
    truncated: audit.truncated,
  };
}

/** Returns a client-safe snapshot: no keys, no audio, secrets redacted. */
export function sanitizeSessionSnapshot(
  snapshot: SessionSnapshotData,
): SessionSnapshotData {
  return {
    sessionId: snapshot.sessionId,
    state: snapshot.state,
    cursor: snapshot.cursor,
    segments: snapshot.segments.map(scrubSegment),
    claims: snapshot.claims.map(scrubClaim),
    verifications: snapshot.verifications.map(scrubVerification),
    ...(snapshot.invalidations === undefined
      ? {}
      : { invalidations: snapshot.invalidations.map(scrubInvalidation) }),
  };
}
