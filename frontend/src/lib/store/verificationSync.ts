import type {
  ClaimStatus,
  FactCheckResult,
  SessionSnapshotData,
  Verification,
  VerificationInvalidatedData,
  Verdict,
} from '@veritas/shared';

/**
 * Pure sync helpers for progressive verification updates (LIVE-028).
 *
 * Rules:
 * - upsert by `id` + `revision` (never blind append);
 * - ignore stale / equal revisions and cross-session events;
 * - invalidation marks the card as superseded without inventing a verdict;
 * - text-mode FactCheckResult bridges into Verification without inferring
 *   SUPPORTED/FALSE from absent flags.
 */

export type UpsertReason = 'inserted' | 'updated' | 'stale' | 'duplicate' | 'wrong-session';

export interface UpsertResult<T> {
  items: T[];
  applied: boolean;
  reason: UpsertReason;
}

export interface Revisioned {
  id: string;
  revision: number;
  sessionId?: string;
}

/**
 * Stable id for a text-mode result.
 * Prefer structured `verification.id` from LIVE-016/017; fall back to
 * fingerprint + chunk + seq for legacy payloads.
 */
export function factCheckResultId(result: FactCheckResult): string {
  return (
    result.data.verification?.id ??
    `${result.meta.fingerprint}-${result.meta.chunk}-${result.meta.seq}`
  );
}

/**
 * Upserts an item keyed by id. Higher revision wins; equal or lower is ignored.
 * When `sessionId` is set on the store, items from another session are ignored.
 */
export function upsertByRevision<T extends Revisioned>(
  items: readonly T[],
  incoming: T,
  sessionId: string | null = null,
): UpsertResult<T> {
  if (
    sessionId !== null &&
    incoming.sessionId !== undefined &&
    incoming.sessionId !== sessionId
  ) {
    return { items: [...items], applied: false, reason: 'wrong-session' };
  }

  const index = items.findIndex((item) => item.id === incoming.id);

  if (index === -1) {
    return {
      items: [...items, incoming],
      applied: true,
      reason: 'inserted',
    };
  }

  const current = items[index];
  if (incoming.revision < current.revision) {
    return { items: [...items], applied: false, reason: 'stale' };
  }
  if (incoming.revision === current.revision) {
    return { items: [...items], applied: false, reason: 'duplicate' };
  }

  const next = [...items];
  next[index] = incoming;
  return { items: next, applied: true, reason: 'updated' };
}

/**
 * Marks a verification as superseded after invalidation.
 * Never invents a verdict — clears conclusive fields so the card cannot look done.
 */
export function applyVerificationInvalidation(
  items: readonly Verification[],
  payload: VerificationInvalidatedData,
  sessionId: string | null = null,
): UpsertResult<Verification> {
  const index = items.findIndex((item) => item.id === payload.verificationId);
  if (index === -1) {
    return { items: [...items], applied: false, reason: 'stale' };
  }

  const current = items[index];
  if (
    sessionId !== null &&
    current.sessionId !== undefined &&
    current.sessionId !== sessionId
  ) {
    return { items: [...items], applied: false, reason: 'wrong-session' };
  }

  if (payload.revision < current.revision) {
    return { items: [...items], applied: false, reason: 'stale' };
  }
  if (payload.revision === current.revision && current.status === 'CANCELLED') {
    return { items: [...items], applied: false, reason: 'duplicate' };
  }

  const superseded: Verification = {
    ...current,
    status: 'CANCELLED',
    revision: Math.max(current.revision, payload.revision),
    verdict: undefined,
    conclusion: undefined,
    contradiction: undefined,
    contradictionEvidenceIds: undefined,
    limitations: [
      ...current.limitations,
      payload.reason.trim().length > 0
        ? payload.reason
        : 'Verificação superada por correção posterior.',
    ],
    updatedAt: new Date().toISOString(),
  };

  const next = [...items];
  next[index] = superseded;
  return { items: next, applied: true, reason: 'updated' };
}

/**
 * Merges a session snapshot into local verifications (same-instance recovery).
 * Only applies items that belong to the snapshot session; uses revision upsert.
 */
export function applySessionSnapshotVerifications(
  items: readonly Verification[],
  snapshot: SessionSnapshotData,
): { items: Verification[]; cursor: number } {
  // A snapshot is authoritative for the session's current cards. Keeping local
  // items that are absent from it resurrects results whose invalidation event
  // was missed while the client was disconnected. Preserve known tombstones so
  // a delayed older snapshot cannot undo an invalidation already received.
  const otherSessions = items.filter(
    (item) => item.sessionId !== undefined && item.sessionId !== snapshot.sessionId,
  );
  const currentSession = items.filter(
    (item) => item.sessionId === undefined || item.sessionId === snapshot.sessionId,
  );
  const snapshotIds = new Set(snapshot.verifications.map((item) => item.id));
  let next = [
    ...otherSessions,
    ...currentSession.filter(
      (item) => item.status === 'CANCELLED' && !snapshotIds.has(item.id),
    ),
  ];

  for (const verification of snapshot.verifications) {
    const result = upsertByRevision(next, verification, snapshot.sessionId);
    next = result.items;
  }

  return { items: next, cursor: snapshot.cursor };
}

/**
 * Maps legacy FactCheckResult flags to a verdict without treating "no flags"
 * as SUPPORTED/FALSE (LIVE-028 complemento).
 */
export function mapFactCheckFlagsToVerdict(
  flags: FactCheckResult['data']['flags'],
): Verdict {
  if (flags?.includes('MISLEADING')) {
    return 'MISLEADING';
  }
  if (
    flags?.includes('INCONCLUSIVE') ||
    flags?.includes('UNVERIFIABLE') ||
    flags?.includes('AMBIGUOUS')
  ) {
    return 'INCONCLUSIVE';
  }
  // Absent flags must not be read as "verified".
  return 'INCONCLUSIVE';
}

const ISO_NOW = (): string => new Date().toISOString();

/**
 * Bridges a text-mode FactCheckResult into the live Verification contract.
 *
 * Prefer `data.verification` from the LIVE-016/017 pipeline when present.
 * Legacy-only payloads fall back to a conservative projection that never
 * invents SUPPORTED/FALSE from absent flags.
 */
export function factCheckResultToVerification(
  result: FactCheckResult,
  options: { sessionId?: string | null; status?: ClaimStatus } = {},
): Verification {
  const structured = result.data.verification;
  if (structured !== undefined) {
    return {
      ...structured,
      sessionId: options.sessionId ?? structured.sessionId,
      ...(options.status !== undefined ? { status: options.status } : {}),
    };
  }

  const id = factCheckResultId(result);
  const claimText = result.data.extractedClaim.trim();
  const accessedAt = ISO_NOW();
  const verdict = mapFactCheckFlagsToVerdict(result.data.flags);
  const isCompleted = options.status === undefined || options.status === 'COMPLETED';
  const sources = (result.data.sources ?? []).map((url, index) => {
    let title = url;
    let publisher = url;
    try {
      const parsed = new URL(url);
      title = parsed.hostname.replace(/^www\./, '');
      publisher = title;
    } catch {
      // keep raw url
    }
    return {
      id: `${id}-src-${index}`,
      title,
      publisher,
      url,
      type: 'OTHER' as const,
      accessedAt,
    };
  });

  const evidence = sources.map((source, index) => ({
    id: `${id}-ev-${index}`,
    sourceId: source.id,
    relation: 'CONTEXTUALIZES' as const,
    claimIds: [`${id}-atomic`],
    excerpt: result.data.reasoning.slice(0, 280),
    explanation: result.data.reasoning,
    // Legacy URLs are not content-verified by the Live pipeline.
    verifiedContent: false,
  }));

  const limitations = [
    'Resultado do modo Texto (contrato legado): veredito não é inferido pela ausência de flags.',
  ];
  if (!result.data.flags || result.data.flags.length === 0) {
    limitations.push(
      'Payload legado sem flags explícitas; apresentado como inconclusivo até o pipeline Live publicar veredito.',
    );
  }

  const mechanisms =
    isCompleted && verdict === 'MISLEADING' && evidence.length > 0
      ? [
          {
            code: 'SELECTIVE_EVIDENCE' as const,
            explanation: result.data.reasoning,
            evidenceIds: [evidence[0].id],
          },
        ]
      : [];

  const now = accessedAt;

  return {
    id,
    sessionId: options.sessionId ?? undefined,
    claimId: id,
    segmentIds: [`text-${result.meta.chunk}`],
    originalQuote: claimText,
    normalizedClaim: claimText,
    transcriptConfirmed: true,
    atomicClaim: {
      id: `${id}-atomic`,
      proposition: claimText,
    },
    status: options.status ?? 'COMPLETED',
    verdict: isCompleted ? verdict : undefined,
    conclusion: isCompleted ? result.data.reasoning : undefined,
    mechanisms,
    supportedAspects:
      verdict === 'MISLEADING'
        ? ['Há um componente factual citado na afirmação; a distorção está na conclusão.']
        : [],
    limitations,
    evidence,
    sources,
    // Legacy seq identifies distinct claims, not revisions of one card.
    revision: 0,
    reviewedBy: 'AUTOMATED',
    createdAt: now,
    updatedAt: now,
  };
}

/** Prefer live verifications; fall back to bridged text-mode results. */
export function selectDisplayVerifications(
  verifications: readonly Verification[],
  results: readonly FactCheckResult[],
  sessionId: string | null = null,
): Verification[] {
  if (verifications.length > 0) {
    return verifications.filter(
      (item) =>
        sessionId === null ||
        item.sessionId === undefined ||
        item.sessionId === sessionId,
    );
  }

  return results.map((result) =>
    factCheckResultToVerification(result, { sessionId }),
  );
}
