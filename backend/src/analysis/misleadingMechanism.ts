import {
  MECHANISM_CODE_SCHEMA,
  type Evidence,
  type Mechanism,
  type MechanismCode,
  type Verdict,
} from '@veritas/shared';

/**
 * Misleading-mechanism helpers (LIVE-021 / spec §8).
 *
 * Mechanisms describe how a formulation diverges from documented evidence.
 * They never assert deliberate intent to lie. Outside MISLEADING they are
 * optional; on SUPPORTED they must not invent a distortion.
 */

/** Codes from the verification specification §8. */
export const MECHANISM_CODES: readonly MechanismCode[] =
  MECHANISM_CODE_SCHEMA.options;

export const MECHANISM_DESCRIPTIONS: Readonly<
  Record<MechanismCode, string>
> = {
  FALSE_ORIGIN_ATTRIBUTION:
    'Falsa atribuição de origem/autoria: o evento ou iniciativa antecede a pessoa/gestão indicada.',
  MISATTRIBUTED_AGGREGATE:
    'Dado agregado atribuído a subconjunto: o número cobre outra população, órgão, local ou categoria.',
  OMITTED_TIME_LIMIT:
    'Omissão de duração: algo temporário foi apresentado como permanente.',
  PROGRAM_CONFLATION:
    'Confusão entre programas/instituições: a fala mistura objetos com regras, nomes ou períodos distintos.',
  INCOMPATIBLE_COMPARISON:
    'Comparação de métricas incompatíveis: o denominador, a metodologia ou a unidade mudou.',
  UNSUPPORTED_CAUSALITY:
    'Causalidade não demonstrada: correlação descrita como causa sem suporte.',
  SELECTIVE_PERIOD:
    'Recorte temporal seletivo: o período omitido altera materialmente a interpretação.',
  OVERGENERALIZATION:
    'Generalização indevida: um caso isolado foi apresentado como regra geral.',
  SELECTIVE_EVIDENCE:
    'Seleção parcial de evidências: foram omitidos dados diretamente pertinentes e divergentes.',
};

export type MechanismDraft = {
  code: MechanismCode;
  explanation: string;
  evidenceIds: readonly string[];
};

export type MisleadingValidation =
  | {
      ok: true;
      mechanisms: Mechanism[];
      supportedAspects: string[];
    }
  | { ok: false; reason: string };

/**
 * Keeps only mechanisms whose code is known, explanation is non-empty and
 * every evidence id refers to verified content. Drops inventados.
 */
export function sanitizeMechanisms(
  drafts: readonly MechanismDraft[] | undefined,
  verifiedById: ReadonlyMap<string, Evidence>,
): Mechanism[] {
  const mechanisms: Mechanism[] = [];
  for (const item of drafts ?? []) {
    if (!MECHANISM_CODE_SCHEMA.safeParse(item.code).success) {
      continue;
    }
    const explanation = item.explanation.trim();
    const evidenceIds: string[] = [];
    for (const evidenceId of item.evidenceIds) {
      const evidence = verifiedById.get(evidenceId);
      if (
        evidence !== undefined &&
        evidence.verifiedContent &&
        !evidenceIds.includes(evidenceId)
      ) {
        evidenceIds.push(evidenceId);
      }
    }
    if (explanation.length === 0 || evidenceIds.length === 0) {
      continue;
    }
    mechanisms.push({ code: item.code, explanation, evidenceIds });
  }
  return mechanisms;
}

/** Mechanisms are required only for MISLEADING; elsewhere they are optional. */
export function mechanismsRequiredFor(verdict: Verdict): boolean {
  return verdict === 'MISLEADING';
}

/**
 * SUPPORTED must not invent a misleading mechanism. FALSE may omit them.
 * MISLEADING keeps only validated mechanisms.
 */
export function mechanismsForVerdict(
  verdict: Verdict,
  mechanisms: readonly Mechanism[],
): Mechanism[] {
  switch (verdict) {
    case 'SUPPORTED':
      // Never invent a distortion on a sustained claim.
      return [];
    case 'MISLEADING':
    case 'FALSE':
    case 'INCONCLUSIVE':
      return [...mechanisms];
    default: {
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}

/**
 * MISLEADING requires a documented true component AND at least one mechanism
 * with verified evidence. Does not infer intent.
 */
export function validateMisleading(
  evidence: readonly Evidence[],
  supportedAspects: readonly string[],
  mechanismDrafts: readonly MechanismDraft[] | undefined,
): MisleadingValidation {
  const aspects = supportedAspects
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (aspects.length === 0) {
    return {
      ok: false,
      reason:
        'Enganosa exige ao menos um aspecto verdadeiro documentado (supportedAspects).',
    };
  }

  const hasVerifiedSupport = evidence.some(
    (item) => item.relation === 'SUPPORTS' && item.verifiedContent,
  );
  if (!hasVerifiedSupport) {
    return {
      ok: false,
      reason:
        'Enganosa exige evidência SUPPORTS verificada para o componente verdadeiro.',
    };
  }

  const verifiedById = new Map(
    evidence
      .filter((item) => item.verifiedContent)
      .map((item) => [item.id, item]),
  );
  const mechanisms = sanitizeMechanisms(mechanismDrafts, verifiedById);
  if (mechanisms.length === 0) {
    return {
      ok: false,
      reason:
        'Enganosa exige ao menos um mecanismo (§8) com evidenceIds verificados e justificativa; não se presume intenção de mentir.',
    };
  }

  return { ok: true, mechanisms, supportedAspects: aspects };
}

/** True when the code is one of the §8 taxonomy entries (incl. PROGRAM_CONFLATION). */
export function isKnownMechanismCode(code: string): code is MechanismCode {
  return MECHANISM_CODE_SCHEMA.safeParse(code).success;
}
