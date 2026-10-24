/**
 * Offline speaker + claim evaluation (LIVE-034, also backs LIVE-015).
 *
 *   pnpm --filter backend eval:speakers
 *
 * Runs annotated dialogues through the real SpeakerRegistry, ContextManager,
 * extractClaims (scripted FakeChatModel) and findDuplicate, then scores three
 * layers separately: diarization, name association and claim extraction.
 */
import { extractClaims } from '#/analysis/claimExtraction.js';
import { buildClaimKey, findDuplicate } from '#/live/claimDeduplication.js';
import { ContextManager, type ContextDependency } from '#/live/contextManager.js';
import {
  SpeakerRegistry,
  type SpeakerObservation,
} from '#/live/speakerIdentification.js';
import { createFakeLLM } from '#/llm/index.js';
import type { Claim, TranscriptSegment } from '@veritas/shared';
import {
  blockingFailures,
  evaluateGate,
  formatGate,
  formatRatio,
  isEntrypoint,
  ratio,
  selfCheck,
  type GateDefinition,
  type GateResult,
  type Ratio,
  type SelfCheck,
} from '../common/gates.js';
import { loadDialogueFixtures } from './load.js';
import type { DialogueFixture, DialogueSegment, GoldClaim } from './types.js';

const SESSION_ID = 'eval-speakers-session';
const CREATED_AT = '2026-10-23T12:00:00.000Z';
/** Overlap coefficient (|A∩B| / min(|A|,|B|)) needed to match a gold quote. */
const QUOTE_MATCH_THRESHOLD = 0.75;

/**
 * Window attribution rule, mirroring `LiveSession.identifySpeaker`: no label
 * or more than one distinct label (simultaneous speech) keeps the window
 * unknown; a single label is registered in the session registry.
 */
export function attributeWindow(
  observations: readonly SpeakerObservation[],
  registry: SpeakerRegistry,
): string | undefined {
  if (observations.length === 0) {
    return undefined;
  }
  const labels = new Set(observations.map((item) => item.speakerLabel));
  if (labels.size !== 1) {
    return undefined;
  }
  const first = observations.at(0);
  return first === undefined ? undefined : registry.observe(first.speakerLabel);
}

export type Authorship =
  | 'CONFIRMED_CORRECT'
  | 'CONFIRMED_WRONG'
  | 'UNCONFIRMED'
  | 'UNKNOWN';

export type ExtractedOccurrence = {
  claim: Claim;
  segmentId: string;
  contextDependencies: ContextDependency[];
  promptText: string;
  reusedFrom?: Claim;
  matchedGoldId?: string;
};

export type DialogueRun = {
  fixture: DialogueFixture;
  registry: SpeakerRegistry;
  segmentSpeaker: Map<string, string | undefined>;
  occurrences: ExtractedOccurrence[];
  /** Segment id → current revision after corrections. */
  currentRevision: Map<string, number>;
  contextBySegment: Map<string, { dependencies: ContextDependency[]; promptText: string }>;
};

function tokens(text: string): string[] {
  const found: string[] =
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}$%,]+/gu) ?? [];
  return found.map((token) => token.replace(/,$/, ''));
}

/** Token overlap coefficient between two quotes (accent/case-insensitive). */
export function quoteSimilarity(left: string, right: string): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  let inter = 0;
  for (const token of a) {
    if (b.has(token)) {
      inter += 1;
    }
  }
  const smaller = Math.min(a.size, b.size);
  return smaller === 0 ? 0 : inter / smaller;
}

function toSegment(segment: DialogueSegment, speakerId: string | undefined, revision = 0, text = segment.text): TranscriptSegment {
  return {
    id: segment.id,
    sessionId: SESSION_ID,
    revision,
    status: 'FINAL',
    text,
    ...(speakerId !== undefined ? { speakerId } : {}),
    startMs: segment.startMs,
    endMs: segment.endMs,
    createdAt: CREATED_AT,
  };
}

function messageText(messages: readonly { content: unknown }[]): string {
  return messages
    .map((message) =>
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    )
    .join('\n');
}

export async function runDialogue(fixture: DialogueFixture): Promise<DialogueRun> {
  const registry = new SpeakerRegistry();
  const segmentSpeaker = new Map<string, string | undefined>();
  for (const segment of fixture.segments) {
    segmentSpeaker.set(segment.id, attributeWindow(segment.observations, registry));
  }
  const participantName = new Map(fixture.participants.map((item) => [item.ref, item.name]));
  for (const entry of fixture.mapping) {
    const speakerId = registry.getSpeakerId(entry.speakerLabel);
    if (speakerId === undefined) {
      continue;
    }
    registry.setMapping(
      speakerId,
      participantName.get(entry.participantRef) ?? entry.participantRef,
      registry.getRevision(),
      { confirmed: entry.confirmed },
    );
  }

  const context = new ContextManager(
    fixture.contextMaxSegments === undefined ? {} : { maxSegments: fixture.contextMaxSegments },
  );
  const occurrences: ExtractedOccurrence[] = [];
  const contextBySegment = new Map<string, { dependencies: ContextDependency[]; promptText: string }>();
  const investigated: Claim[] = [];

  for (const segment of fixture.segments) {
    const speakerId = segmentSpeaker.get(segment.id);
    context.addSegment(toSegment(segment, speakerId));
    const window = context.getContext({ excludeSegmentId: segment.id });
    const llm = createFakeLLM([JSON.stringify(segment.extraction)]);
    const claims = await extractClaims({
      text: segment.text,
      context: window.text,
      llm,
      source: {
        sessionId: SESSION_ID,
        segmentIds: [segment.id],
        ...(speakerId !== undefined ? { speakerId } : {}),
        timestampMs: { start: segment.startMs, end: segment.endMs },
      },
      fingerprint: `${fixture.id}-${segment.id}`,
    });
    const promptText = messageText(llm.calls[0] ?? []);
    contextBySegment.set(segment.id, { dependencies: window.dependencies, promptText });

    for (const claim of claims) {
      const occurrence: ExtractedOccurrence = {
        claim,
        segmentId: segment.id,
        contextDependencies: window.dependencies,
        promptText,
      };
      if (!claim.notFactCheckable) {
        const match = findDuplicate(claim, investigated);
        if (match === null) {
          investigated.push(claim);
        } else {
          occurrence.reusedFrom = match.claim;
        }
      }
      occurrences.push(occurrence);
    }
  }

  const currentRevision = new Map(fixture.segments.map((segment) => [segment.id, 0]));
  for (const segment of fixture.segments) {
    if (segment.correction !== undefined) {
      context.addSegment(
        toSegment(segment, segmentSpeaker.get(segment.id), 1, segment.correction.text),
      );
      currentRevision.set(segment.id, 1);
    }
  }
  // Confirm the ContextManager accepted the corrections (monotonic revisions).
  for (const stored of context.getSegments()) {
    currentRevision.set(stored.id, stored.revision);
  }

  matchGold(fixture, occurrences);
  return { fixture, registry, segmentSpeaker, occurrences, currentRevision, contextBySegment };
}

function matchGold(fixture: DialogueFixture, occurrences: ExtractedOccurrence[]): void {
  const used = new Set<string>();
  for (const occurrence of occurrences) {
    let best: { id: string; score: number } | undefined;
    for (const gold of fixture.goldClaims) {
      if (gold.segmentId !== occurrence.segmentId || used.has(gold.id)) {
        continue;
      }
      const score = quoteSimilarity(gold.quote, occurrence.claim.originalQuote);
      if (score >= QUOTE_MATCH_THRESHOLD && (best === undefined || score > best.score)) {
        best = { id: gold.id, score };
      }
    }
    if (best !== undefined) {
      used.add(best.id);
      occurrence.matchedGoldId = best.id;
    }
  }
}

export function isStale(run: DialogueRun, occurrence: ExtractedOccurrence): boolean {
  const deps: ContextDependency[] = [
    ...occurrence.claim.segmentIds.map((id) => ({ id, revision: 0 })),
    ...occurrence.contextDependencies,
  ];
  return deps.some((dep) => (run.currentRevision.get(dep.id) ?? 0) > dep.revision);
}

export function authorshipFor(
  run: DialogueRun,
  speakerId: string | undefined,
  refSpeaker: string | null,
): Authorship {
  if (speakerId === undefined) {
    return 'UNKNOWN';
  }
  const mapping = run.registry.getMapping(speakerId);
  if (mapping === undefined) {
    return 'UNKNOWN';
  }
  if (!mapping.confirmed) {
    return 'UNCONFIRMED';
  }
  const expectedName = run.fixture.participants.find((item) => item.ref === refSpeaker)?.name;
  return mapping.participantName === expectedName ? 'CONFIRMED_CORRECT' : 'CONFIRMED_WRONG';
}

export type SpeakerClaimMetrics = {
  diarization: {
    /** Segments with a single attributed label / annotated segments. */
    attributed: Ratio;
    /** Label errors among attributed segments (purity vs majority ref). */
    errorAmongAttributed: Ratio;
    /** Correct attributions / annotated segments (unknown is not a hit). */
    accuracyIncludingUnknown: Ratio;
    /** Simultaneous-speech segments kept unknown / overlap segments. */
    overlapKeptUnknown: Ratio;
  };
  association: {
    confirmedCorrect: Ratio;
    unconfirmed: Ratio;
  };
  authorship: {
    confirmedCorrect: Ratio;
    confirmedWrong: Ratio;
    unconfirmed: Ratio;
    unknown: Ratio;
  };
  extraction: {
    precision: Ratio;
    recall: Ratio;
    nfcTriage: Ratio;
    incompleteNotExtracted: Ratio;
    quoteFidelity: Ratio;
  };
  duplicates: {
    missedDuplicateInvestigations: Ratio;
    falseMerges: Ratio;
    duplicateRate: Ratio;
    sameFactOtherAuthorPreserved: Ratio;
  };
  context: {
    contextLoss: Ratio;
    authorshipLeaks: Ratio;
    unknownShownWithName: Ratio;
    staleDetection: Ratio;
    staleFalseAlarms: Ratio;
  };
};

type Counter = { n: number; d: number };
const counter = (): Counter => ({ n: 0, d: 0 });
const bump = (c: Counter, hit: boolean): void => {
  c.d += 1;
  if (hit) {
    c.n += 1;
  }
};
const toRatio = (c: Counter): Ratio => ratio(c.n, c.d);

function goldById(fixture: DialogueFixture): Map<string, GoldClaim> {
  return new Map(fixture.goldClaims.map((item) => [item.id, item]));
}

export function computeSpeakerClaimMetrics(
  runs: readonly DialogueRun[],
  options: { diarizationProvenance?: readonly string[] } = {},
): SpeakerClaimMetrics {
  const c = {
    attributed: counter(),
    errorAmongAttributed: counter(),
    accuracy: counter(),
    overlap: counter(),
    assocCorrect: counter(),
    assocUnconfirmed: counter(),
    authCorrect: counter(),
    authWrong: counter(),
    authUnconfirmed: counter(),
    authUnknown: counter(),
    precision: counter(),
    recall: counter(),
    nfc: counter(),
    incomplete: counter(),
    fidelity: counter(),
    missedDup: counter(),
    falseMerge: counter(),
    dupRate: counter(),
    sameFact: counter(),
    contextLoss: counter(),
    leaks: counter(),
    unknownNamed: counter(),
    stale: counter(),
    staleFalse: counter(),
  };

  for (const run of runs) {
    const { fixture } = run;
    const includeDiarization =
      options.diarizationProvenance === undefined ||
      options.diarizationProvenance.includes(fixture.diarizationProvenance);
    const segmentsById = new Map(fixture.segments.map((item) => [item.id, item]));
    const gold = goldById(fixture);

    // --- Diarization (acoustic labels only) ---
    const labelRefCounts = new Map<string, Map<string, number>>();
    for (const segment of fixture.segments) {
      const speakerId = run.segmentSpeaker.get(segment.id);
      if (speakerId === undefined || segment.refSpeaker === null) {
        continue;
      }
      const counts = labelRefCounts.get(speakerId) ?? new Map<string, number>();
      counts.set(segment.refSpeaker, (counts.get(segment.refSpeaker) ?? 0) + 1);
      labelRefCounts.set(speakerId, counts);
    }
    const majority = new Map<string, string>();
    for (const [speakerId, counts] of labelRefCounts) {
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).at(0);
      if (top !== undefined) {
        majority.set(speakerId, top[0]);
      }
    }
    for (const segment of fixture.segments) {
      if (segment.refSpeaker === null) {
        continue;
      }
      const speakerId = run.segmentSpeaker.get(segment.id);
      const authorship = authorshipFor(run, speakerId, segment.refSpeaker);
      if (includeDiarization) {
        bump(c.attributed, speakerId !== undefined);
        if (speakerId !== undefined) {
          bump(c.errorAmongAttributed, majority.get(speakerId) !== segment.refSpeaker);
        }
        bump(c.accuracy, speakerId !== undefined && majority.get(speakerId) === segment.refSpeaker);
        if (segment.overlapWith.length > 0) {
          bump(c.overlap, speakerId === undefined);
        }
      }
      bump(c.authCorrect, authorship === 'CONFIRMED_CORRECT');
      bump(c.authWrong, authorship === 'CONFIRMED_WRONG');
      bump(c.authUnconfirmed, authorship === 'UNCONFIRMED');
      bump(c.authUnknown, authorship === 'UNKNOWN');
    }

    // --- Name association (manual mapping vs. what the label really is) ---
    for (const mapping of run.registry.getMappings()) {
      const expectedRef = majority.get(mapping.speakerId);
      const expectedName = fixture.participants.find((item) => item.ref === expectedRef)?.name;
      bump(c.assocUnconfirmed, !mapping.confirmed);
      if (mapping.confirmed) {
        bump(c.assocCorrect, mapping.participantName === expectedName);
      }
    }

    // --- Extraction ---
    const checkable = run.occurrences.filter((item) => !item.claim.notFactCheckable);
    const matchedGold = new Map(
      run.occurrences
        .filter((item) => item.matchedGoldId !== undefined)
        .map((item) => [item.matchedGoldId!, item]),
    );
    for (const occurrence of checkable) {
      const goldClaim =
        occurrence.matchedGoldId === undefined ? undefined : gold.get(occurrence.matchedGoldId);
      bump(c.precision, goldClaim?.kind === 'CHECKABLE');
    }
    for (const goldClaim of fixture.goldClaims) {
      const occurrence = matchedGold.get(goldClaim.id);
      if (goldClaim.kind === 'CHECKABLE') {
        bump(c.recall, occurrence !== undefined && !occurrence.claim.notFactCheckable);
      } else if (goldClaim.kind === 'NOT_FACT_CHECKABLE') {
        bump(c.nfc, occurrence === undefined || occurrence.claim.notFactCheckable);
      } else {
        bump(c.incomplete, occurrence === undefined || occurrence.claim.notFactCheckable);
      }
    }
    for (const occurrence of run.occurrences) {
      const segment = segmentsById.get(occurrence.segmentId);
      bump(c.fidelity, segment !== undefined && segment.text.includes(occurrence.claim.originalQuote));
      // Authorship is copied from the source segment, never from context.
      bump(c.leaks, occurrence.claim.speakerId !== run.segmentSpeaker.get(occurrence.segmentId));
      // Unknown authorship (no attributable voice) must never surface a name.
      if (run.segmentSpeaker.get(occurrence.segmentId) === undefined) {
        bump(
          c.unknownNamed,
          occurrence.claim.speakerId !== undefined,
        );
      }
    }

    // --- Duplicates ---
    for (const occurrence of checkable) {
      const goldClaim =
        occurrence.matchedGoldId === undefined ? undefined : gold.get(occurrence.matchedGoldId);
      const goldDuplicate = goldClaim?.duplicateOf !== undefined;
      if (occurrence.reusedFrom !== undefined) {
        const reusedOccurrence = run.occurrences.find((item) => item.claim.id === occurrence.reusedFrom?.id);
        const target = goldClaim?.duplicateOf;
        bump(c.falseMerge, !(goldDuplicate && reusedOccurrence?.matchedGoldId === target));
      }
      bump(c.dupRate, goldDuplicate && occurrence.reusedFrom === undefined);
    }
    for (const goldClaim of fixture.goldClaims) {
      if (goldClaim.duplicateOf === undefined) {
        continue;
      }
      const occurrence = matchedGold.get(goldClaim.id);
      bump(c.missedDup, occurrence?.reusedFrom === undefined);
      const original = gold.get(goldClaim.duplicateOf);
      if (original !== undefined && original.speakerRef !== goldClaim.speakerRef) {
        const first = matchedGold.get(original.id);
        bump(
          c.sameFact,
          occurrence !== undefined &&
            first !== undefined &&
            occurrence.claim.id !== first.claim.id &&
            occurrence.claim.segmentIds.join() !== first.claim.segmentIds.join() &&
            occurrence.claim.speakerId === run.segmentSpeaker.get(goldClaim.segmentId) &&
            buildClaimKey(occurrence.claim) === buildClaimKey(first.claim),
        );
      }
    }

    // --- Context ---
    for (const goldClaim of fixture.goldClaims) {
      if (goldClaim.requiresContextSegmentIds.length === 0) {
        continue;
      }
      const window = run.contextBySegment.get(goldClaim.segmentId);
      const ids = new Set(window?.dependencies.map((dep) => dep.id) ?? []);
      const hasIds = goldClaim.requiresContextSegmentIds.every((id) => ids.has(id));
      const hasText =
        goldClaim.requiresContextText === undefined ||
        (window?.promptText.includes(goldClaim.requiresContextText) ?? false);
      bump(c.contextLoss, !(hasIds && hasText));
    }
    for (const occurrence of run.occurrences) {
      const goldClaim =
        occurrence.matchedGoldId === undefined ? undefined : gold.get(occurrence.matchedGoldId);
      const stale = isStale(run, occurrence);
      if (goldClaim?.staleAfterCorrection === true) {
        bump(c.stale, stale);
      } else {
        bump(c.staleFalse, stale);
      }
    }
  }

  return {
    diarization: {
      attributed: toRatio(c.attributed),
      errorAmongAttributed: toRatio(c.errorAmongAttributed),
      accuracyIncludingUnknown: toRatio(c.accuracy),
      overlapKeptUnknown: toRatio(c.overlap),
    },
    association: {
      confirmedCorrect: toRatio(c.assocCorrect),
      unconfirmed: toRatio(c.assocUnconfirmed),
    },
    authorship: {
      confirmedCorrect: toRatio(c.authCorrect),
      confirmedWrong: toRatio(c.authWrong),
      unconfirmed: toRatio(c.authUnconfirmed),
      unknown: toRatio(c.authUnknown),
    },
    extraction: {
      precision: toRatio(c.precision),
      recall: toRatio(c.recall),
      nfcTriage: toRatio(c.nfc),
      incompleteNotExtracted: toRatio(c.incomplete),
      quoteFidelity: toRatio(c.fidelity),
    },
    duplicates: {
      missedDuplicateInvestigations: toRatio(c.missedDup),
      falseMerges: toRatio(c.falseMerge),
      duplicateRate: toRatio(c.dupRate),
      sameFactOtherAuthorPreserved: toRatio(c.sameFact),
    },
    context: {
      contextLoss: toRatio(c.contextLoss),
      authorshipLeaks: toRatio(c.leaks),
      unknownShownWithName: toRatio(c.unknownNamed),
      staleDetection: toRatio(c.stale),
      staleFalseAlarms: toRatio(c.staleFalse),
    },
  };
}

const gate = (
  id: string,
  description: string,
  comparator: '>=' | '<=',
  threshold: number,
  minSamples: number,
  kind: GateDefinition['kind'] = 'BLOCKING',
): GateDefinition => ({ id, description, comparator, threshold, minSamples, kind });

/** Provisional targets — to be ratified in LIVE-000 on real debate audio. */
export const SPEAKER_CLAIM_GATES = {
  precision: gate('extraction-precision', 'Claims verificáveis extraídas que batem com o gold / extraídas', '>=', 0.8, 10),
  recall: gate('extraction-recall', 'Claims gold verificáveis encontradas / gold verificáveis', '>=', 0.8, 10),
  nfc: gate('nfc-triage', 'Falas não verificáveis mantidas fora da investigação / gold não verificáveis', '>=', 0.75, 4),
  incomplete: gate('incomplete-not-extracted', 'Afirmações incompletas não investigadas / incompletas', '>=', 1, 1),
  fidelity: gate('quote-fidelity', 'originalQuote literal do segmento / ocorrências', '>=', 1, 10),
  missedDup: gate('missed-duplicate-investigations', 'Repetições investigadas de novo / repetições gold', '<=', 0.1, 2),
  falseMerge: gate('false-merges', 'Reusos indevidos / reusos decididos', '<=', 0, 1),
  sameFact: gate('same-fact-other-author-preserved', 'Mesmo fato por outro autor com ocorrência e autoria próprias / casos', '>=', 1, 1),
  contextLoss: gate('context-loss', 'Claims sem o contexto necessário no prompt / claims dependentes de contexto', '<=', 0.1, 3),
  leaks: gate('authorship-leaks', 'Claims com autoria diferente do segmento de origem / ocorrências', '<=', 0, 10),
  unknownNamed: gate('unknown-shown-with-name', 'Claims de autoria desconhecida exibidas com nome / desconhecidas', '<=', 0, 1),
  stale: gate('stale-after-correction', 'Claims invalidadas após correção / anotadas como invalidáveis', '>=', 1, 1),
  staleFalse: gate('stale-false-alarms', 'Claims invalidadas sem dependência corrigida / não anotadas', '<=', 0, 1),
  overlap: gate('overlap-kept-unknown', 'Falas simultâneas mantidas como autoria desconhecida / falas simultâneas', '>=', 1, 1),
  // Readiness: automatic authorship can only be declared on RECORDED diarization.
  autoAccuracy: gate('automatic-authorship-accuracy', 'Atribuições corretas / segmentos anotados (desconhecido não conta como acerto) — só diarização RECORDED', '>=', 0.9, 200, 'READINESS'),
  autoErrors: gate('automatic-authorship-voice-errors', 'Erros entre vozes atribuídas / atribuídas — só diarização RECORDED', '<=', 0.05, 150, 'READINESS'),
} satisfies Record<string, GateDefinition>;

export type SpeakerClaimReport = {
  runs: DialogueRun[];
  metrics: SpeakerClaimMetrics;
  recordedDiarization: SpeakerClaimMetrics;
  gates: GateResult[];
  selfChecks: SelfCheck[];
  automaticAuthorshipReady: boolean;
};

export async function runSpeakerClaimEval(): Promise<SpeakerClaimReport> {
  const fixtures = await loadDialogueFixtures();
  const runs: DialogueRun[] = [];
  for (const fixture of fixtures) {
    runs.push(await runDialogue(fixture));
  }
  const metrics = computeSpeakerClaimMetrics(runs);
  const recordedDiarization = computeSpeakerClaimMetrics(
    runs.filter((run) => run.fixture.media.kind === 'REAL_DEBATE'),
    { diarizationProvenance: ['RECORDED'] },
  );
  const g = SPEAKER_CLAIM_GATES;
  const gates = [
    evaluateGate(g.precision, metrics.extraction.precision),
    evaluateGate(g.recall, metrics.extraction.recall),
    evaluateGate(g.nfc, metrics.extraction.nfcTriage),
    evaluateGate(g.incomplete, metrics.extraction.incompleteNotExtracted),
    evaluateGate(g.fidelity, metrics.extraction.quoteFidelity),
    evaluateGate(g.missedDup, metrics.duplicates.missedDuplicateInvestigations),
    evaluateGate(g.falseMerge, metrics.duplicates.falseMerges),
    evaluateGate(g.sameFact, metrics.duplicates.sameFactOtherAuthorPreserved),
    evaluateGate(g.contextLoss, metrics.context.contextLoss),
    evaluateGate(g.leaks, metrics.context.authorshipLeaks),
    evaluateGate(g.unknownNamed, metrics.context.unknownShownWithName),
    evaluateGate(g.stale, metrics.context.staleDetection),
    evaluateGate(g.staleFalse, metrics.context.staleFalseAlarms),
    evaluateGate(g.overlap, metrics.diarization.overlapKeptUnknown),
    evaluateGate(g.autoAccuracy, recordedDiarization.diarization.accuracyIncludingUnknown),
    evaluateGate(g.autoErrors, recordedDiarization.diarization.errorAmongAttributed),
  ];

  const selfChecks: SelfCheck[] = [];
  for (const run of runs) {
    const ids = run.occurrences.map((item) => item.claim.id);
    selfChecks.push(
      selfCheck(
        `distinct-occurrence-ids:${run.fixture.id}`,
        new Set(ids).size === ids.length,
        'cada ocorrência deve ter id próprio',
      ),
    );
    const goldIds = new Set(run.fixture.goldClaims.map((item) => item.id));
    const matched = run.occurrences.filter((item) => item.matchedGoldId !== undefined);
    selfChecks.push(
      selfCheck(
        `gold-match-integrity:${run.fixture.id}`,
        matched.every((item) => goldIds.has(item.matchedGoldId!)) &&
          new Set(matched.map((item) => item.matchedGoldId)).size === matched.length,
        'cada gold casa com no máximo uma ocorrência',
      ),
    );
  }

  const automaticAuthorshipReady =
    gates.filter((item) => item.kind === 'READINESS').every((item) => item.status === 'PASS');

  return { runs, metrics, recordedDiarization, gates, selfChecks, automaticAuthorshipReady };
}

export function speakerClaimEvalFailed(report: SpeakerClaimReport): boolean {
  return blockingFailures(report.gates).length > 0 || report.selfChecks.some((item) => !item.ok);
}

export function formatSpeakerClaimReport(report: SpeakerClaimReport): string {
  const m = report.metrics;
  const lines = [
    'Avaliação de locutores e claims (LIVE-034 / LIVE-015) — métricas com denominadores',
    `Diálogos: ${report.runs.map((run) => `${run.fixture.id} (mídia=${run.fixture.media.kind}, diarização=${run.fixture.diarizationProvenance}, extração=${run.fixture.extractionProvenance})`).join('; ')}`,
    'AVISO: diarização SIMULATED sobre texto não mede qualidade de diarização; extração SCRIPTED (FakeChatModel) testa o pós-processamento, não o LLM.',
    '',
    '1) Diarização (rótulos acústicos; simulada aqui):',
    `  Segmentos com rótulo único: ${formatRatio(m.diarization.attributed)}`,
    `  Erro entre vozes atribuídas: ${formatRatio(m.diarization.errorAmongAttributed)}`,
    `  Acerto incluindo desconhecidos (desconhecido ≠ acerto): ${formatRatio(m.diarization.accuracyIncludingUnknown)}`,
    `  Falas simultâneas mantidas desconhecidas: ${formatRatio(m.diarization.overlapKeptUnknown)}`,
    '2) Associação aos nomes (mapeamento manual):',
    `  Mapeamentos confirmados corretos: ${formatRatio(m.association.confirmedCorrect)}`,
    `  Mapeamentos não confirmados: ${formatRatio(m.association.unconfirmed)}`,
    '  Cobertura de autoria por segmento:',
    `    - confirmada correta: ${formatRatio(m.authorship.confirmedCorrect)}`,
    `    - confirmada ERRADA: ${formatRatio(m.authorship.confirmedWrong)}`,
    `    - não confirmada: ${formatRatio(m.authorship.unconfirmed)}`,
    `    - desconhecida: ${formatRatio(m.authorship.unknown)}`,
    '3) Extração de claims:',
    `  Precisão: ${formatRatio(m.extraction.precision)}`,
    `  Recall: ${formatRatio(m.extraction.recall)}`,
    `  Triagem não verificável: ${formatRatio(m.extraction.nfcTriage)}`,
    `  Incompletas não investigadas: ${formatRatio(m.extraction.incompleteNotExtracted)}`,
    `  Fidelidade literal do trecho: ${formatRatio(m.extraction.quoteFidelity)}`,
    '  Duplicatas:',
    `    - repetições investigadas de novo: ${formatRatio(m.duplicates.missedDuplicateInvestigations)}`,
    `    - reusos indevidos: ${formatRatio(m.duplicates.falseMerges)}`,
    `    - taxa de claims duplicadas não deduplicadas: ${formatRatio(m.duplicates.duplicateRate)}`,
    `    - mesmo fato/outro autor com ocorrência própria: ${formatRatio(m.duplicates.sameFactOtherAuthorPreserved)}`,
    '  Contexto e autoria:',
    `    - perda de contexto: ${formatRatio(m.context.contextLoss)}`,
    `    - vazamento de autoria: ${formatRatio(m.context.authorshipLeaks)}`,
    `    - desconhecido exibido com nome: ${formatRatio(m.context.unknownShownWithName)}`,
    `    - invalidação após correção: ${formatRatio(m.context.staleDetection)}`,
    `    - invalidação indevida: ${formatRatio(m.context.staleFalseAlarms)}`,
    '',
    'Gates:',
    ...report.gates.map((item) => `  ${formatGate(item)}`),
    '',
    'Autochecagens:',
    ...report.selfChecks.map((item) => `  [${item.ok ? 'OK' : 'FALHA'}] ${item.name}${item.ok ? '' : ` — ${item.detail ?? ''}`}`),
    '',
    `Autoria automática pronta: ${report.automaticAuthorshipReady ? 'SIM' : 'NÃO — sem diarização RECORDED em debate real com amostra mínima (LIVE-000); fallback desconhecido não conta como acerto'}`,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const report = await runSpeakerClaimEval();
  console.log(formatSpeakerClaimReport(report));
  if (speakerClaimEvalFailed(report)) {
    console.error('\nAvaliação de locutores/claims reprovada (gate bloqueante ou autochecagem).');
    process.exitCode = 1;
  }
}

if (isEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
