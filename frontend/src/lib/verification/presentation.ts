import type {
  ClaimStatus,
  Evidence,
  EvidenceRelation,
  Mechanism,
  MechanismCode,
  Source,
  SpeakerMapping,
  Verification,
  Verdict,
} from '@veritas/shared';

/**
 * Pure presentation helpers for the three-layer verification card (LIVE-027).
 *
 * No React, no i18n context, no DOM access: everything here is deterministic so
 * it can be unit-tested with `node --test` and reused by selectors/stores.
 * The PT-BR strings below are the editorial defaults; the card prefers the
 * `liveCard` i18n namespace and falls back to these helpers when a locale is
 * incomplete.
 *
 * Editorial rules enforced here (spec §2, §3, §11):
 * - a verdict is only ever exposed for a COMPLETED verification;
 * - a contradiction is only exposed for a completed FALSE result;
 * - nothing is derived from thin air: every text helper falls back to another
 *   field that the backend actually wrote, or returns `null`.
 */

// ===== Labels =====

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  DETECTED: 'Detectada',
  QUEUED: 'Na fila',
  RESEARCHING: 'Buscando fontes',
  EVALUATING: 'Avaliando evidências',
  COMPLETED: 'Concluída',
  FAILED: 'Falha técnica',
  CANCELLED: 'Cancelada',
  DEFERRED: 'Adiada',
  BLOCKED: 'Bloqueada',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  SUPPORTED: 'Sustentada',
  FALSE: 'Falsa',
  MISLEADING: 'Enganosa',
  INCONCLUSIVE: 'Inconclusiva',
};

export const MECHANISM_LABELS: Record<MechanismCode, string> = {
  FALSE_ORIGIN_ATTRIBUTION: 'Falsa atribuição de origem ou autoria',
  MISATTRIBUTED_AGGREGATE: 'Dado agregado atribuído ao universo errado',
  OMITTED_TIME_LIMIT: 'Omissão de duração ou prazo',
  PROGRAM_CONFLATION: 'Confusão entre programas ou instituições',
  INCOMPATIBLE_COMPARISON: 'Comparação de métricas incompatíveis',
  UNSUPPORTED_CAUSALITY: 'Causalidade não demonstrada',
  SELECTIVE_PERIOD: 'Recorte temporal seletivo',
  OVERGENERALIZATION: 'Generalização indevida',
  SELECTIVE_EVIDENCE: 'Seleção parcial de evidências',
};

export const EVIDENCE_RELATION_LABELS: Record<EvidenceRelation, string> = {
  SUPPORTS: 'Sustenta',
  REFUTES: 'Contradiz',
  CONTEXTUALIZES: 'Contextualiza',
};

export function getStatusLabel(status: ClaimStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function getVerdictLabel(verdict: Verdict): string {
  return VERDICT_LABELS[verdict] ?? verdict;
}

export function getMechanismLabel(code: MechanismCode): string {
  return MECHANISM_LABELS[code] ?? code;
}

export function getEvidenceRelationLabel(relation: EvidenceRelation): string {
  return EVIDENCE_RELATION_LABELS[relation] ?? relation;
}

// ===== Verdict guards =====

export type DefinitiveVerification = Verification & {
  status: 'COMPLETED';
  verdict: Verdict;
};

/** Only a completed verification that carries a verdict may display one. */
export function isDefinitive(
  verification: Verification,
): verification is DefinitiveVerification {
  return (
    verification.status === 'COMPLETED' &&
    verification.verdict !== undefined &&
    verification.verdict !== null
  );
}

/** Never leaks an in-flight verdict: anything short of COMPLETED returns `null`. */
export function getDisplayVerdict(verification: Verification): Verdict | null {
  return isDefinitive(verification) ? verification.verdict : null;
}

// ===== Text helpers =====

const toText = (value?: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const joinTexts = (
  values: readonly string[] | undefined,
  separator = ' ',
): string | null => {
  const parts = (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return parts.length > 0 ? parts.join(separator) : null;
};

/** The literal quote — editorial annotations never live inside `originalQuote`. */
export function deriveWhatSaid(verification: Verification): string | null {
  return toText(verification.originalQuote);
}

/**
 * The documented counterpoint shown next to the quote.
 * - FALSE: the contradiction (falls back to the conclusion);
 * - MISLEADING: the supported aspects (falls back to the conclusion);
 * - SUPPORTED: the conclusion (no artificial contradiction);
 * - INCONCLUSIVE: what remained open (falls back to the conclusion).
 */
export function deriveWhatFound(verification: Verification): string | null {
  if (!isDefinitive(verification)) {
    return null;
  }

  switch (verification.verdict) {
    case 'FALSE':
      return toText(verification.contradiction) ?? toText(verification.conclusion);
    case 'MISLEADING':
      return (
        joinTexts(verification.supportedAspects) ??
        toText(verification.conclusion)
      );
    case 'SUPPORTED':
      return toText(verification.conclusion);
    case 'INCONCLUSIVE':
      return joinTexts(verification.limitations) ?? toText(verification.conclusion);
    default:
      return null;
  }
}

/** Highlighted contradiction block: completed FALSE results only. */
export function deriveContradiction(verification: Verification): string | null {
  if (!isDefinitive(verification) || verification.verdict !== 'FALSE') {
    return null;
  }
  return toText(verification.contradiction) ?? toText(verification.conclusion);
}

export function getSupportedAspects(verification: Verification): string[] {
  return (verification.supportedAspects ?? [])
    .map((aspect) => aspect.trim())
    .filter((aspect) => aspect.length > 0);
}

export function getLimitations(verification: Verification): string[] {
  return (verification.limitations ?? [])
    .map((limitation) => limitation.trim())
    .filter((limitation) => limitation.length > 0);
}

/**
 * The contract carries attribution as `speakerId` only. The card must show that
 * reference or an explicit "authorship not confirmed" label — never invent a name.
 */
export function getSpeakerLabel(
  verification: Verification,
  mappings: readonly SpeakerMapping[] = [],
): string | null {
  const speakerId = toText(verification.speakerId);
  if (speakerId === null) return null;
  const mapping = mappings.find((item) => item.speakerId === speakerId && item.confirmed);
  return toText(mapping?.participantName) ?? speakerId;
}

// ===== Evidence =====

export interface ResolvedEvidence {
  evidence: Evidence;
  source: Source;
}

const compareText = (left: string, right: string): number => {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/** Deterministic source order; does not deduplicate. */
export function sortSources(sources: readonly Source[]): Source[] {
  return [...sources].sort(
    (a, b) =>
      compareText(a.publisher, b.publisher) ||
      compareText(a.title, b.title) ||
      compareText(a.url, b.url) ||
      compareText(a.id, b.id),
  );
}

/**
 * Collapses repeated URLs so a syndicated article is never counted as
 * independent corroboration (spec §12).
 */
export function getUniqueSources(sources: readonly Source[]): Source[] {
  const seenUrls = new Set<string>();
  const unique: Source[] = [];

  for (const source of sortSources(sources)) {
    if (seenUrls.has(source.url)) continue;
    seenUrls.add(source.url);
    unique.push(source);
  }

  return unique;
}

export function getPrimarySources(verification: Verification): Source[] {
  return getUniqueSources(
    (verification.sources ?? []).filter((source) => source.type === 'PRIMARY'),
  );
}

/** Evidence joined with its document; entries with a dangling `sourceId` are dropped. */
export function resolveEvidence(verification: Verification): ResolvedEvidence[] {
  const sourcesById = new Map(
    (verification.sources ?? []).map((source) => [source.id, source]),
  );
  const resolved: ResolvedEvidence[] = [];

  for (const evidence of verification.evidence ?? []) {
    const source = sourcesById.get(evidence.sourceId);
    if (source === undefined) continue;
    resolved.push({ evidence, source });
  }

  return resolved.sort(
    (a, b) =>
      compareText(a.evidence.id, b.evidence.id) ||
      compareText(a.source.url, b.source.url),
  );
}

export function getVerifiedEvidence(verification: Verification): ResolvedEvidence[] {
  return resolveEvidence(verification).filter(
    (item) => item.evidence.verifiedContent,
  );
}

/**
 * Evidence the adapter did not verify: surfaced with a warning so it is visible
 * for audit, never as proof.
 */
export function getUnverifiedEvidence(verification: Verification): ResolvedEvidence[] {
  return resolveEvidence(verification).filter(
    (item) => !item.evidence.verifiedContent,
  );
}

const byRelation =
  (relation: EvidenceRelation) =>
  (verification: Verification): ResolvedEvidence[] =>
    getVerifiedEvidence(verification).filter(
      (item) => item.evidence.relation === relation,
    );

export const getSupportingEvidence = byRelation('SUPPORTS');
export const getRefutingEvidence = byRelation('REFUTES');
export const getContextEvidence = byRelation('CONTEXTUALIZES');

/** Evidence cited by a mechanism, in the order declared; dangling ids are dropped. */
export function getMechanismEvidence(
  verification: Verification,
  mechanism: Mechanism,
): ResolvedEvidence[] {
  const evidenceById = new Map(
    resolveEvidence(verification).map((item) => [item.evidence.id, item]),
  );

  return (mechanism.evidenceIds ?? [])
    .map((evidenceId) => evidenceById.get(evidenceId))
    .filter((item): item is ResolvedEvidence => item !== undefined);
}

/** Unique documents behind a set of evidence rows (duplicate URLs count once). */
export function countUniqueSources(items: readonly ResolvedEvidence[]): number {
  return new Set(items.map((item) => item.source.url)).size;
}

// ===== Formatting =====

const pad = (value: number): string => String(value).padStart(2, '0');

/** Media time as `mm:ss` (minutes keep growing past an hour). */
export function formatTimestamp(ms?: number | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) {
    return '00:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${pad(minutes)}:${pad(seconds)}`;
}

const isValidYmd = (year: number, month: number, day: number): boolean => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/**
 * Safe `dd/mm/yyyy` formatter. The calendar date is read from the ISO string so
 * a timestamp with an offset never shifts a day; malformed input returns `null`
 * instead of "Invalid Date".
 */
export function formatIsoDate(value?: string | null): string | null {
  const text = toText(value);
  if (text === null) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match !== null) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidYmd(year, month, day)) return null;
    return `${pad(day)}/${pad(month)}/${year}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
}
