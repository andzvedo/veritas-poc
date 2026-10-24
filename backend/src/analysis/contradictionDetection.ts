import type { Evidence } from '@veritas/shared';

/**
 * Contradiction detection helpers (LIVE-021).
 *
 * A contradiction is never invented: it must point at verified REFUTES
 * evidence. SUPPORTED / incomplete investigations must not carry one.
 */

export type ContradictionFinding = {
  contradiction: string;
  contradictionEvidenceIds: string[];
};

export type ContradictionValidation =
  | { ok: true; finding: ContradictionFinding }
  | { ok: false; reason: string };

/** Verified REFUTES evidence that may back a FALSE verdict. */
export function selectRefutingEvidence(
  evidence: readonly Evidence[],
): Evidence[] {
  return evidence.filter(
    (item) => item.relation === 'REFUTES' && item.verifiedContent,
  );
}

/**
 * Builds a contradiction from decisive REFUTES evidence. Prefers an explicit
 * explanation; falls back to the excerpt. Returns undefined when nothing
 * verified refutes the claim — callers must not invent text.
 */
export function detectContradiction(
  evidence: readonly Evidence[],
  explicitContradiction?: string,
  explicitEvidenceIds?: readonly string[],
): ContradictionFinding | undefined {
  const refuting = selectRefutingEvidence(evidence);
  if (refuting.length === 0) {
    return undefined;
  }

  const refutingIds = new Set(refuting.map((item) => item.id));
  const requestedIds = (explicitEvidenceIds ?? [])
    .map((id) => id.trim())
    .filter((id) => refutingIds.has(id));

  const contradictionEvidenceIds =
    requestedIds.length > 0 ? unique(requestedIds) : refuting.map((item) => item.id);

  const fromExplicit = explicitContradiction?.trim() ?? '';
  const contradiction =
    fromExplicit.length > 0
      ? fromExplicit
      : buildDefaultContradiction(refuting, contradictionEvidenceIds);

  if (contradiction.length === 0 || contradictionEvidenceIds.length === 0) {
    return undefined;
  }

  return { contradiction, contradictionEvidenceIds };
}

export function validateContradiction(
  evidence: readonly Evidence[],
  contradiction: string | undefined,
  contradictionEvidenceIds: readonly string[] | undefined,
): ContradictionValidation {
  const finding = detectContradiction(
    evidence,
    contradiction,
    contradictionEvidenceIds,
  );
  if (finding === undefined) {
    return {
      ok: false,
      reason:
        'Contradição ausente: é necessário trecho verificado com relação REFUTES e texto específico do conflito factual.',
    };
  }

  const trimmed = contradiction?.trim() ?? '';
  if (trimmed.length === 0) {
    return {
      ok: false,
      reason:
        'Contradição ausente: o conflito factual precisa ser descrito em texto.',
    };
  }

  const ids = contradictionEvidenceIds ?? [];
  if (ids.length === 0) {
    return {
      ok: false,
      reason:
        'Contradição incompleta: informe ao menos um evidenceId REFUTES verificado.',
    };
  }

  const refutingIds = new Set(
    selectRefutingEvidence(evidence).map((item) => item.id),
  );
  for (const id of ids) {
    if (!refutingIds.has(id)) {
      return {
        ok: false,
        reason: `Evidência de contradição "${id}" não é REFUTES verificada.`,
      };
    }
  }

  return {
    ok: true,
    finding: {
      contradiction: trimmed,
      contradictionEvidenceIds: unique(
        ids.filter((id) => refutingIds.has(id)),
      ),
    },
  };
}

type WithOptionalContradiction = {
  contradiction?: string;
  contradictionEvidenceIds?: string[];
};

/**
 * SUPPORTED (and any non-FALSE candidate) must not invent a contradiction.
 * Returns a shallow copy without contradiction fields.
 */
export function stripInventedContradiction<T extends WithOptionalContradiction>(
  candidate: T,
): T {
  const copy = { ...candidate };
  delete copy.contradiction;
  delete copy.contradictionEvidenceIds;
  return copy;
}

function buildDefaultContradiction(
  refuting: readonly Evidence[],
  evidenceIds: readonly string[],
): string {
  const selected = refuting.filter((item) => evidenceIds.includes(item.id));
  const primary = selected.at(0) ?? refuting.at(0);
  if (primary === undefined) {
    return '';
  }
  const explanation = primary.explanation.trim();
  if (explanation.length > 0) {
    return explanation;
  }
  return primary.excerpt.trim();
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
