import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  FACT_CHECK_RESULT_SCHEMA,
  type Claim,
  type FactCheckResult,
  type Verification,
  notFactCheckableToLegacyFactCheckData,
  verificationToLegacyFactCheckData,
} from '@veritas/shared';
import { extractClaims } from '#/analysis/claimExtraction.js';
import { evaluateEvidence } from '#/analysis/evidenceEvaluation.js';
import { retrieveEvidence } from '#/analysis/evidenceRetrieval.js';
import { generateVerification } from '#/analysis/verdictGeneration.js';
import {
  ResearchError,
  type ResearchProvider,
} from '#/research/index.js';

/**
 * Text-mode evidence engine (LIVE-017).
 *
 * Flow per chunk: extractClaims → (per claim) retrieveEvidence →
 * evaluateEvidence → generateVerification. Research is always attempted for
 * fact-checkable claims; model self-confidence never gates investigation.
 */

export type TextVerificationPipelineArgs = {
  chunks: string[];
  fingerprint: string;
  extractionLlm: BaseChatModel;
  evaluationLlm: BaseChatModel;
  researchProvider: ResearchProvider;
  signal?: AbortSignal;
  now?: () => Date;
};

export type InvestigateClaimArgs = {
  claim: Claim;
  extractionChunkIndex: number;
  evaluationLlm: BaseChatModel;
  researchProvider: ResearchProvider;
  signal?: AbortSignal;
  now?: () => Date;
};

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal === undefined || !signal.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  const error = new Error('Text verification aborted');
  error.name = 'AbortError';
  throw error;
}

function isoNow(now?: () => Date): string {
  return (now ?? (() => new Date()))().toISOString();
}

function operationalVerification(
  claim: Claim,
  status: 'FAILED' | 'DEFERRED' | 'CANCELLED',
  limitation: string,
  now?: () => Date,
): Verification {
  const timestamp = isoNow(now);
  const atomicClaim =
    claim.atomicClaims[0] ??
    ({
      id: `${claim.id}-atomic-0`,
      proposition: claim.normalizedClaim,
    } as const);

  return {
    id: `verification-${claim.id}-0`,
    ...(claim.sessionId !== undefined ? { sessionId: claim.sessionId } : {}),
    claimId: claim.id,
    segmentIds: [...claim.segmentIds],
    ...(claim.speakerId !== undefined ? { speakerId: claim.speakerId } : {}),
    originalQuote: claim.originalQuote,
    normalizedClaim: claim.normalizedClaim,
    ...(claim.timestampMs !== undefined
      ? { timestampMs: { ...claim.timestampMs } }
      : {}),
    transcriptConfirmed: true,
    atomicClaim,
    status,
    revision: 0,
    reviewedBy: 'AUTOMATED',
    createdAt: timestamp,
    updatedAt: timestamp,
    mechanisms: [],
    supportedAspects: [],
    limitations: [limitation],
    evidence: [],
    sources: [],
  };
}

function researchFailureToVerification(
  claim: Claim,
  error: ResearchError,
  now?: () => Date,
): Verification {
  switch (error.kind) {
    case 'QUOTA':
      return operationalVerification(
        claim,
        'DEFERRED',
        'Cota do provedor de pesquisa esgotada; a investigação foi adiada sem emitir veredito factual.',
        now,
      );
    case 'TIMEOUT':
      return operationalVerification(
        claim,
        'FAILED',
        'Tempo esgotado ao recuperar documentos; falha técnica distinta de falta de evidência.',
        now,
      );
    case 'TRANSIENT':
      return operationalVerification(
        claim,
        'FAILED',
        'Falha temporária do provedor de pesquisa; não equivale a falta de evidência documental.',
        now,
      );
    case 'UNAVAILABLE':
      return operationalVerification(
        claim,
        'FAILED',
        'Documento ou provedor indisponível; falha técnica distinta de investigação inconclusiva.',
        now,
      );
    case 'INVALID':
      return operationalVerification(
        claim,
        'FAILED',
        'Resposta inválida do provedor de pesquisa; falha técnica distinta de falta de evidência.',
        now,
      );
    default: {
      const _exhaustive: never = error.kind;
      return _exhaustive;
    }
  }
}

function toFactCheckResult(
  data: ReturnType<typeof verificationToLegacyFactCheckData>,
  meta: { fingerprint: string; chunk: number; seq: number },
): FactCheckResult {
  return FACT_CHECK_RESULT_SCHEMA.parse({ data, meta });
}

/**
 * Investigates a single claim end-to-end. Used by the text pipeline and by
 * unit tests that inject providers/LLMs without Socket.IO.
 */
export async function investigateClaim(
  args: InvestigateClaimArgs,
): Promise<FactCheckResult['data']> {
  const { claim, evaluationLlm, researchProvider, signal, now } = args;
  throwIfAborted(signal);

  if (claim.notFactCheckable) {
    return notFactCheckableToLegacyFactCheckData(claim);
  }

  try {
    const retrieval = await retrieveEvidence({
      claim,
      provider: researchProvider,
      signal,
      now,
    });
    throwIfAborted(signal);

    const evaluation = await evaluateEvidence({
      claim,
      sources: retrieval.sources,
      documents: retrieval.documents,
      llm: evaluationLlm,
    });
    throwIfAborted(signal);

    const gaps = [
      ...evaluation.gaps,
      ...retrieval.failures.map(
        (failure) => `${failure.url}: ${failure.reason}`,
      ),
    ];

    // Preliminary classification is never authoritative: generateVerification
    // rebuilds verdict/flags from inspected evidence only.
    const verification = await generateVerification({
      claim: { ...claim, status: 'EVALUATING' },
      sources: retrieval.sources,
      evidence: evaluation.evidence,
      gaps,
      transcriptConfirmed: true,
      llm: evaluationLlm,
      now,
    });

    return verificationToLegacyFactCheckData(verification);
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof ResearchError) {
      return verificationToLegacyFactCheckData(
        researchFailureToVerification(claim, error, now),
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return verificationToLegacyFactCheckData(
      operationalVerification(
        claim,
        'FAILED',
        `Falha técnica na investigação: ${error instanceof Error ? error.message : String(error)}. Erro operacional não gera veredito definitivo.`,
        now,
      ),
    );
  }
}

/**
 * Runs the full text-mode pipeline over chunked input and yields one
 * FACT_CHECK_RESULT per claim (plus callers yield CHUNK_COUNT separately).
 */
export async function* runTextVerificationPipeline(
  args: TextVerificationPipelineArgs,
): AsyncGenerator<FactCheckResult> {
  const {
    chunks,
    fingerprint,
    extractionLlm,
    evaluationLlm,
    researchProvider,
    signal,
    now,
  } = args;

  let seq = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    throwIfAborted(signal);
    const chunk = chunks[chunkIndex];
    if (chunk.trim().length === 0) {
      continue;
    }

    const claims = await extractClaims({
      text: chunk,
      llm: extractionLlm,
      source: {
        segmentIds: [`text-chunk-${String(chunkIndex)}`],
      },
      fingerprint: `${fingerprint}-c${String(chunkIndex)}`,
    });

    for (const claim of claims) {
      throwIfAborted(signal);
      const data = await investigateClaim({
        claim,
        extractionChunkIndex: chunkIndex,
        evaluationLlm,
        researchProvider,
        signal,
        now,
      });

      yield toFactCheckResult(data, {
        fingerprint,
        chunk: chunkIndex,
        seq: seq++,
      });
    }
  }
}
