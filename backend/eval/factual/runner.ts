/**
 * Offline factual evaluation suite (LIVE-024).
 *
 * Runs against the frozen corpus + scripted Fake LLM / Fake research
 * providers. No Gemini/Tavily keys required.
 *
 *   pnpm --filter backend eval:factual
 */

import { BLOCKED_LIMITATION } from '#/analysis/verdictGeneration.js';
import {
  draftToVerification,
  generateVerification,
  parseVerdictDraft,
} from '#/analysis/verdictGeneration.js';
import { createFakeLLM } from '#/llm/index.js';
import {
  ResearchError,
  createFakeResearchProvider,
  withResearchBudget,
  ResearchUsageBudget,
} from '#/research/index.js';
import type {
  Claim,
  Evidence,
  Source,
  Verification,
  Verdict,
} from '@veritas/shared';
import { VERIFICATION_SCHEMA } from '@veritas/shared';
import { loadAllFixtures, loadCorpusDocument } from './load.js';
import { computeMetrics, formatMetricsReport } from './metrics.js';
import type { CaseCheckResult, FixtureCase } from './types.js';

const NOW = () => new Date('2026-10-23T12:00:00.000Z');

function buildClaim(fixture: FixtureCase): Claim {
  const timestamp = NOW().toISOString();
  return {
    id: `claim-${fixture.id}`,
    sessionId: 'eval-session',
    segmentIds: [`segment-${fixture.id}`],
    speakerId: fixture.participant,
    originalQuote: fixture.originalQuote,
    normalizedClaim: fixture.normalizedClaim,
    status: 'RESEARCHING',
    notFactCheckable: false,
    atomicClaims: [
      {
        id: `atomic-${fixture.id}`,
        proposition: fixture.atomicProposition,
      },
    ],
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function buildSources(fixture: FixtureCase): Promise<Source[]> {
  const accessedAt = NOW().toISOString();
  const sources: Source[] = [];
  for (const item of fixture.sources) {
    const source: Source = {
      id: item.id,
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      type: item.type,
      accessedAt,
    };
    if (item.publishedAt !== undefined) {
      source.publishedAt = item.publishedAt;
    }
    if (item.dataPeriod !== undefined) {
      source.dataPeriod = item.dataPeriod;
    }
    if (item.corpusDocumentId !== undefined) {
      const body = await loadCorpusDocument(item.corpusDocumentId);
      source.contentHash = `sha256-offline:${String(body.length)}:${item.corpusDocumentId}`;
    }
    sources.push(source);
  }
  return sources;
}

function buildEvidence(fixture: FixtureCase, claimId: string): Evidence[] {
  return fixture.evidence.map((item) => ({
    id: item.id,
    sourceId: item.sourceId,
    relation: item.relation,
    claimIds: [claimId],
    excerpt: item.excerpt,
    explanation: item.explanation,
    verifiedContent: item.verifiedContent,
    ...(item.location !== undefined ? { location: item.location } : {}),
  }));
}

function buildBaseVerification(
  fixture: FixtureCase,
  claim: Claim,
  sources: Source[],
  evidence: Evidence[],
): Verification {
  const timestamp = NOW().toISOString();
  return {
    id: `verification-${fixture.id}`,
    sessionId: claim.sessionId,
    claimId: claim.id,
    segmentIds: [...claim.segmentIds],
    speakerId: claim.speakerId,
    originalQuote: claim.originalQuote,
    normalizedClaim: claim.normalizedClaim,
    transcriptConfirmed: fixture.transcriptConfirmed,
    atomicClaim:
      claim.atomicClaims[0] ?? {
        id: `atomic-${fixture.id}`,
        proposition: fixture.atomicProposition,
      },
    status: 'BLOCKED',
    revision: 0,
    reviewedBy: 'AUTOMATED',
    createdAt: timestamp,
    updatedAt: timestamp,
    mechanisms: [],
    supportedAspects: [],
    limitations: [],
    evidence,
    sources,
  };
}

export async function runCompletedCase(
  fixture: FixtureCase,
): Promise<Verification> {
  const claim = buildClaim(fixture);
  const sources = await buildSources(fixture);
  const evidence = buildEvidence(fixture, claim.id);
  const base = buildBaseVerification(fixture, claim, sources, evidence);

  if (!fixture.transcriptConfirmed) {
    return {
      ...base,
      status: 'BLOCKED',
      limitations: [BLOCKED_LIMITATION],
    };
  }

  if (fixture.verdictDraft === undefined) {
    throw new Error(`Fixture ${fixture.id} sem verdictDraft para COMPLETED.`);
  }

  const draftJson = JSON.stringify(fixture.verdictDraft);
  const draft = parseVerdictDraft(draftJson);
  const verified = evidence.filter((item) => item.verifiedContent);

  if (verified.length === 0) {
    return draftToVerification(base, draft, verified, fixture.gaps);
  }

  // Prefer the invariant path directly (offline, no network). Also exercise
  // generateVerification with FakeChatModel to ensure the fake adapter works.
  const llm = createFakeLLM([draftJson]);
  return generateVerification({
    claim,
    sources,
    evidence,
    gaps: fixture.gaps,
    transcriptConfirmed: true,
    llm,
    now: NOW,
    verificationId: base.id,
  });
}

export async function runOperationalCase(
  fixture: FixtureCase,
): Promise<Verification> {
  const claim = buildClaim(fixture);
  const sources = await buildSources(fixture);
  const evidence = buildEvidence(fixture, claim.id);
  const base = buildBaseVerification(fixture, claim, sources, evidence);
  const expectedStatus = fixture.expected.status;

  switch (expectedStatus) {
    case 'BLOCKED':
      return {
        ...base,
        status: 'BLOCKED',
        limitations: [BLOCKED_LIMITATION],
      };
    case 'DEFERRED': {
      // Exercise the budget wrapper: exhaustion must surface as QUOTA, never
      // as a fabricated factual verdict.
      const budget = new ResearchUsageBudget({ maxSearches: 0 });
      const provider = withResearchBudget(
        createFakeResearchProvider({ hits: [] }),
        budget,
      );
      let quotaSeen = false;
      try {
        await provider.search('cota-offline');
      } catch (error) {
        quotaSeen =
          error instanceof ResearchError && error.kind === 'QUOTA';
        if (!quotaSeen) {
          throw error;
        }
      }
      if (!quotaSeen) {
        throw new Error('Orçamento de pesquisa deveria ter esgotado.');
      }
      return {
        ...base,
        status: 'DEFERRED',
        limitations: [
          'Cota do provedor de pesquisa esgotada; a investigação foi adiada sem emitir veredito factual.',
        ],
      };
    }
    case 'FAILED':
      return {
        ...base,
        status: 'FAILED',
        limitations: [
          'Falha técnica do provedor de pesquisa; não equivale a falta de evidência documental.',
        ],
      };
    case 'CANCELLED':
      return {
        ...base,
        status: 'CANCELLED',
        limitations: ['Verificação cancelada antes da conclusão.'],
      };
    default:
      return runCompletedCase(fixture);
  }
}

function check(
  name: string,
  ok: boolean,
  detail?: string,
): CaseCheckResult['checks'][number] {
  return detail === undefined ? { name, ok } : { name, ok, detail };
}

export function evaluateCase(
  fixture: FixtureCase,
  verification: Verification,
): CaseCheckResult {
  const checks: CaseCheckResult['checks'] = [];
  const expected = fixture.expected;

  const schema = VERIFICATION_SCHEMA.safeParse(verification);
  checks.push(
    check(
      'schema',
      schema.success,
      schema.success
        ? undefined
        : schema.error.issues
            .slice(0, 3)
            .map((issue) => issue.message)
            .join('; '),
    ),
  );

  checks.push(
    check(
      'status',
      verification.status === expected.status,
      `esperado ${expected.status}, obtido ${verification.status}`,
    ),
  );

  if (expected.verdict !== undefined) {
    checks.push(
      check(
        'verdict',
        verification.verdict === expected.verdict,
        `esperado ${expected.verdict}, obtido ${String(verification.verdict)}`,
      ),
    );
  }

  if (expected.preserveLiteralQuote) {
    const literalOk = verification.originalQuote === fixture.originalQuote;
    const annotation = expected.editorialAnnotation;
    let editorialLeakDetail: string | undefined;
    let noEditorialInside = true;
    if (annotation !== undefined) {
      noEditorialInside = !fixture.originalQuote.includes(annotation);
      if (!noEditorialInside) {
        editorialLeakDetail = `anotação editorial "${annotation}" não deve entrar em originalQuote`;
      }
    }
    checks.push(
      check(
        'literal-quote',
        literalOk && noEditorialInside,
        editorialLeakDetail,
      ),
    );
  }

  if (expected.contradictionRequired) {
    const hasText =
      (verification.contradiction?.trim().length ?? 0) > 0 &&
      (verification.contradictionEvidenceIds?.length ?? 0) > 0;
    checks.push(
      check(
        'contradiction',
        hasText,
        hasText ? undefined : 'contradição documentada ausente',
      ),
    );
  } else if (expected.verdict === 'SUPPORTED') {
    checks.push(
      check(
        'no-invented-contradiction',
        verification.contradiction === undefined &&
          (verification.contradictionEvidenceIds?.length ?? 0) === 0,
        'SUPPORTED não deve inventar contradição',
      ),
    );
  }

  if (expected.expectedMechanismCodes.length > 0) {
    const got = new Set(verification.mechanisms.map((item) => item.code));
    const missing = expected.expectedMechanismCodes.filter(
      (code) => !got.has(code),
    );
    checks.push(
      check(
        'mechanisms',
        missing.length === 0,
        missing.length === 0
          ? undefined
          : `faltam mecanismos: ${missing.join(', ')}`,
      ),
    );
  }

  for (const needle of expected.supportedAspectSubstrings) {
    const ok = verification.supportedAspects.some((aspect) =>
      aspect.toLowerCase().includes(needle.toLowerCase()),
    );
    checks.push(
      check(
        `supported-aspect:${needle}`,
        ok,
        ok ? undefined : `aspecto sustentado sem "${needle}"`,
      ),
    );
  }

  for (const needle of expected.limitationSubstrings) {
    const haystack = verification.limitations.join(' ').toLowerCase();
    const ok = haystack.includes(needle.toLowerCase());
    checks.push(
      check(
        `limitation:${needle}`,
        ok,
        ok ? undefined : `limitação sem "${needle}"`,
      ),
    );
  }

  const operationalStatuses = new Set([
    'BLOCKED',
    'FAILED',
    'DEFERRED',
    'CANCELLED',
  ]);
  if (operationalStatuses.has(expected.status)) {
    const noVerdict = verification.verdict === undefined;
    checks.push(
      check(
        'no-invented-verdict',
        noVerdict,
        noVerdict
          ? undefined
          : `status ${expected.status} não pode carregar veredito ${String(verification.verdict as Verdict)}`,
      ),
    );
  }

  const indirectOk = fixture.sources
    .filter((source) => source.indirect || source.unreproducedOfficialQuery)
    .every((source) => source.notes !== undefined || source.indirect);
  checks.push(
    check(
      'indirect-sources-marked',
      indirectOk ||
        fixture.sources.every(
          (source) => !source.indirect && !source.unreproducedOfficialQuery,
        ),
    ),
  );

  return {
    caseId: fixture.id,
    family: fixture.family,
    participant: fixture.participant,
    passed: checks.every((item) => item.ok),
    checks,
  };
}

export async function runFactualEval(): Promise<{
  results: CaseCheckResult[];
  metrics: ReturnType<typeof computeMetrics>;
}> {
  const fixtures = await loadAllFixtures();
  const results: CaseCheckResult[] = [];

  for (const fixture of fixtures) {
    const verification =
      fixture.expected.status === 'COMPLETED'
        ? await runCompletedCase(fixture)
        : await runOperationalCase(fixture);
    results.push(evaluateCase(fixture, verification));
  }

  return { results, metrics: computeMetrics(results) };
}

async function main(): Promise<void> {
  const { results, metrics } = await runFactualEval();
  console.log(formatMetricsReport(metrics));
  console.log('');

  let failed = 0;
  for (const result of results) {
    const mark = result.passed ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${result.caseId}`);
    if (!result.passed) {
      failed += 1;
      for (const item of result.checks.filter((check) => !check.ok)) {
        console.log(`  - ${item.name}: ${item.detail ?? 'falhou'}`);
      }
    }
  }

  if (failed > 0) {
    console.error(
      `\n${String(failed)}/${String(results.length)} caso(s) falharam.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nTodos os ${String(results.length)} casos passaram (offline).`);
}

const entrypoint = process.argv[1] ?? '';
if (entrypoint.endsWith('runner.ts') || entrypoint.endsWith('runner.js')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
