import { FactCheckRequest, ServerToClientEvents } from '#/ws/types.js';
import { ValidationError } from '#/utils/errors.js';
import * as Consts from '#/constants.js';
import { applyChunking } from '#/chunking/index.js';
import { runTextVerificationPipeline } from '#/analysis/textVerificationPipeline.js';
import { getAdvancedLLM, getLiteLLM } from '#/llm/index.js';
import { createTavilyProvider } from '#/research/tavily.js';

type EventsPayload = Parameters<
  ServerToClientEvents['FACT_CHECK_RESULT' | 'CHUNK_COUNT']
>[0];

export type FactCheckServiceOptions = {
  /** Optional abort signal; disconnect/cancel should abort in-flight research. */
  signal?: AbortSignal;
};

/**
 * Manual text-mode fact check (LIVE-017).
 *
 * Uses the shared evidence engine: extraction → retrieval → evaluation →
 * verdict. Does not gate research on `reasoningConfidence` or
 * `researchThreshold` (the latter remains on the request for compatibility).
 */
export async function* factCheckService(
  content: string,
  factCheckReq: FactCheckRequest,
  options: FactCheckServiceOptions = {},
): AsyncGenerator<EventsPayload> {
  if (content.trim().length === 0) {
    throw new ValidationError('Text is required');
  }

  if (content.length > Consts.MAX_TEXT_LENGTH) {
    throw new ValidationError(
      `Text too long (max ${Consts.MAX_TEXT_LENGTH.toFixed(0)} characters)`,
    );
  }

  const liteLLM = getLiteLLM(factCheckReq.apiKeys.google);
  const advancedLLM = getAdvancedLLM(factCheckReq.apiKeys.google);
  const researchProvider = createTavilyProvider({
    apiKey: factCheckReq.apiKeys.tavily,
  });
  const chunks = await applyChunking(content);

  yield {
    meta: { fingerprint: factCheckReq.fingerprint },
    data: { chunkCount: chunks.length },
  };

  // researchThreshold is intentionally unused: investigation always runs for
  // fact-checkable claims (LIVE-017). Kept on the wire for older clients.
  void factCheckReq.researchThreshold;

  yield* runTextVerificationPipeline({
    chunks,
    fingerprint: factCheckReq.fingerprint,
    extractionLlm: liteLLM,
    evaluationLlm: advancedLLM,
    researchProvider,
    signal: options.signal,
  });
}
