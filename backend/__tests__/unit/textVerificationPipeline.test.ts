import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Claim } from '@veritas/shared';
import {
  FACT_CHECK_RESULT_SCHEMA,
  TEXT_MODE_RESULT_VERSION,
  VERIFICATION_SCHEMA,
} from '@veritas/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  investigateClaim,
  runTextVerificationPipeline,
} from '#/analysis/textVerificationPipeline.js';
import { ResearchError } from '#/research/types.js';
import type {
  ExtractedDocument,
  ResearchProvider,
  SearchHit,
  SearchOptions,
  ExtractOptions,
} from '#/research/types.js';

const LONG_CONTENT =
  'A Lei nº 12.865, de 9 de outubro de 2013, autorizou o Banco Central do Brasil a instituir o Pix. '.repeat(
    5,
  );

const NOW = () => new Date('2025-01-10T12:00:05.000Z');

const FACT_CHECKABLE_CLAIM: Claim = {
  id: 'claim-1',
  segmentIds: ['text-chunk-0'],
  originalQuote: 'O Pix foi criado em 2015.',
  normalizedClaim: 'O Pix foi criado em 2015.',
  status: 'DETECTED',
  notFactCheckable: false,
  atomicClaims: [{ id: 'atomic-1', proposition: 'O Pix foi criado em 2015.' }],
  revision: 0,
  createdAt: '2025-01-10T12:00:00.000Z',
  updatedAt: '2025-01-10T12:00:00.000Z',
};

const OPINION_CLAIM: Claim = {
  ...FACT_CHECKABLE_CLAIM,
  id: 'claim-opinion',
  originalQuote: 'Eu acho que o governo errou.',
  normalizedClaim: 'Eu acho que o governo errou.',
  notFactCheckable: true,
  atomicClaims: [],
};

type LlmReply = string | Error;

function createLlm(...replies: LlmReply[]) {
  const invoke = vi.fn((input: unknown): Promise<{ text: string }> => {
    void input;
    const reply = replies.shift();
    if (reply === undefined) {
      return Promise.reject(new Error('sem resposta simulada'));
    }
    return reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve({ text: reply });
  });
  return { llm: { invoke } as unknown as BaseChatModel, invoke };
}

class FakeProvider implements ResearchProvider {
  readonly searches: { query: string; options?: SearchOptions }[] = [];
  readonly extracts: { url: string; options?: ExtractOptions }[] = [];

  constructor(
    private readonly config: {
      hits?: SearchHit[];
      documents?: Record<string, string>;
      searchError?: Error;
    } = {},
  ) {}

  search(query: string, options?: SearchOptions): Promise<SearchHit[]> {
    this.searches.push({ query, options });
    if (options?.signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    }
    if (this.config.searchError !== undefined) {
      return Promise.reject(this.config.searchError);
    }
    return Promise.resolve(
      this.config.hits ?? [
        {
          title: 'Lei do Pix',
          url: 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/lei/l12865.htm',
        },
      ],
    );
  }

  extract(url: string, options?: ExtractOptions): Promise<ExtractedDocument> {
    this.extracts.push({ url, options });
    if (options?.signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    }
    const content = this.config.documents?.[url] ?? LONG_CONTENT;
    return Promise.resolve({ url, title: 'Documento', content });
  }
}

const FALSE_VERDICT_JSON = JSON.stringify({
  verdict: 'FALSE',
  conclusion: 'O Pix não foi criado em 2015.',
  contradiction: 'A norma que autorizou o Pix é de 2013.',
  contradictionEvidenceIds: ['ev-1'],
  limitations: [],
});

const EVALUATION_JSON = JSON.stringify({
  evidence: [
    {
      sourceId: 'src-1',
      relation: 'REFUTES',
      excerpt:
        'A Lei nº 12.865, de 9 de outubro de 2013, autorizou o Banco Central do Brasil a instituir o Pix.',
      explanation: 'A lei é de 2013, não de 2015.',
    },
  ],
  gaps: [],
});

const EXTRACTION_JSON = JSON.stringify([
  {
    originalQuote: 'O Pix foi criado em 2015.',
    normalizedClaim: 'O Pix foi criado em 2015.',
    notFactCheckable: false,
    subject: 'Pix',
    predicate: 'foi criado',
    period: { start: '2015' },
  },
]);

describe('investigateClaim (LIVE-017 wiring)', () => {
  it('always researches fact-checkable claims without a confidence gate', async () => {
    const provider = new FakeProvider();
    const { llm, invoke } = createLlm(EVALUATION_JSON, FALSE_VERDICT_JSON);

    const data = await investigateClaim({
      claim: FACT_CHECKABLE_CLAIM,
      extractionChunkIndex: 0,
      evaluationLlm: llm,
      researchProvider: provider,
      now: NOW,
    });

    expect(provider.searches).toHaveLength(1);
    expect(provider.extracts.length).toBeGreaterThan(0);
    expect(invoke).toHaveBeenCalled();
    expect(data.resultVersion).toBe(TEXT_MODE_RESULT_VERSION);
    expect(data.verification).toBeDefined();
    expect(VERIFICATION_SCHEMA.safeParse(data.verification).success).toBe(true);
    expect(data.verification?.status).toBe('COMPLETED');
    expect(data.verification?.verdict).toBe('FALSE');
    expect(data.extractedClaim).toBe('O Pix foi criado em 2015.');
    expect(data.sources?.length).toBeGreaterThan(0);
    // Preliminary confidence must not appear as authority; verdict comes from evidence.
    expect(data.verification?.evidence.some((e) => e.verifiedContent)).toBe(
      true,
    );
  });

  it('skips research for notFactCheckable triage and never invents a definitive verdict', async () => {
    const provider = new FakeProvider();
    const { llm, invoke } = createLlm();

    const data = await investigateClaim({
      claim: OPINION_CLAIM,
      extractionChunkIndex: 0,
      evaluationLlm: llm,
      researchProvider: provider,
      now: NOW,
    });

    expect(provider.searches).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(data.verification).toBeUndefined();
    expect(data.flags).toEqual(['UNVERIFIABLE']);
    expect(data.reasoningConfidence).toBe(0);
  });

  it('maps provider quota to DEFERRED without a factual verdict', async () => {
    const provider = new FakeProvider({
      searchError: new ResearchError('QUOTA', 'cota esgotada', { status: 429 }),
    });
    const { llm } = createLlm();

    const data = await investigateClaim({
      claim: FACT_CHECKABLE_CLAIM,
      extractionChunkIndex: 0,
      evaluationLlm: llm,
      researchProvider: provider,
      now: NOW,
    });

    expect(data.verification?.status).toBe('DEFERRED');
    expect(data.verification?.verdict).toBeUndefined();
    expect(data.verification?.limitations[0]).toMatch(/cota/i);
    expect(data.flags).toEqual(['INCONCLUSIVE']);
  });

  it('maps technical search failure distinctly from lack of evidence', async () => {
    const provider = new FakeProvider({
      searchError: new ResearchError('TIMEOUT', 'timeout'),
    });
    const { llm } = createLlm();

    const data = await investigateClaim({
      claim: FACT_CHECKABLE_CLAIM,
      extractionChunkIndex: 0,
      evaluationLlm: llm,
      researchProvider: provider,
      now: NOW,
    });

    expect(data.verification?.status).toBe('FAILED');
    expect(data.verification?.verdict).toBeUndefined();
    expect(data.verification?.limitations[0]).toMatch(/técnica|tempo/i);
    expect(data.reasoning).not.toMatch(/search unavailable/i);
  });

  it('propagates abort to the research provider and discards work', async () => {
    const provider = new FakeProvider();
    const { llm } = createLlm(EVALUATION_JSON, FALSE_VERDICT_JSON);
    const controller = new AbortController();
    controller.abort();

    await expect(
      investigateClaim({
        claim: FACT_CHECKABLE_CLAIM,
        extractionChunkIndex: 0,
        evaluationLlm: llm,
        researchProvider: provider,
        signal: controller.signal,
        now: NOW,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('yields INCONCLUSIVE with limitations when no documents are inspected', async () => {
    const provider = new FakeProvider({ hits: [], documents: {} });
    const { llm, invoke } = createLlm();

    const data = await investigateClaim({
      claim: FACT_CHECKABLE_CLAIM,
      extractionChunkIndex: 0,
      evaluationLlm: llm,
      researchProvider: provider,
      now: NOW,
    });

    // No inspected documents → no definitive verdict; LLM synthesis is skipped.
    expect(data.verification?.status).toBe('COMPLETED');
    expect(data.verification?.verdict).toBe('INCONCLUSIVE');
    expect(data.verification?.limitations.length).toBeGreaterThan(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('runTextVerificationPipeline', () => {
  it('extracts claims then investigates each without a confidence threshold', async () => {
    const provider = new FakeProvider();
    const extraction = createLlm(EXTRACTION_JSON);
    const evaluation = createLlm(EVALUATION_JSON, FALSE_VERDICT_JSON);

    const results: ReturnType<typeof FACT_CHECK_RESULT_SCHEMA.parse>[] = [];
    for await (const result of runTextVerificationPipeline({
      chunks: ['O Pix foi criado em 2015.'],
      fingerprint: 'fp-1',
      extractionLlm: extraction.llm,
      evaluationLlm: evaluation.llm,
      researchProvider: provider,
      now: NOW,
    })) {
      results.push(FACT_CHECK_RESULT_SCHEMA.parse(result));
    }

    expect(results).toHaveLength(1);
    expect(results[0].meta).toEqual({ fingerprint: 'fp-1', chunk: 0, seq: 0 });
    expect(results[0].data.verification?.verdict).toBe('FALSE');
    expect(provider.searches.length).toBe(1);
    expect(extraction.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('legacy confidence is not a research gate', () => {
  it('still researches even when a caller would have set a high threshold', async () => {
    const provider = new FakeProvider();
    const { llm } = createLlm(EVALUATION_JSON, FALSE_VERDICT_JSON);

    // Simulate the old gate condition: confidence below a high threshold would
    // have skipped research. The new path always retrieves.
    const pretendedConfidence = 0.1;
    const researchThreshold = 0.9;
    expect(pretendedConfidence).toBeLessThan(researchThreshold);

    await investigateClaim({
      claim: FACT_CHECKABLE_CLAIM,
      extractionChunkIndex: 0,
      evaluationLlm: llm,
      researchProvider: provider,
      now: NOW,
    });

    expect(provider.searches.length).toBe(1);
  });
});
