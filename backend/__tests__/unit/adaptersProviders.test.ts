import { describe, expect, it } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import {
  LlmError,
  LlmUsageBudget,
  createFakeLLM,
  createLlmProvider,
  resolveLlmProviderKind,
} from '#/llm/index.js';
import {
  ResearchError,
  ResearchUsageBudget,
  createFakeResearchProvider,
  createResearchProvider,
  resolveResearchProviderKind,
  withResearchBudget,
} from '#/research/index.js';

describe('LIVE-018 LLM adapters', () => {
  it('defaults to fake when no credentials are configured (no paid billing)', () => {
    expect(
      resolveLlmProviderKind({ env: {} }),
    ).toBe('fake');
  });

  it('prefers local OpenAI-compatible endpoints as the free default', () => {
    expect(
      resolveLlmProviderKind({
        env: { LLM_BASE_URL: 'http://127.0.0.1:11434/v1' },
      }),
    ).toBe('local');
  });

  it('runs FakeChatModel without network access', async () => {
    const llm = createFakeLLM(['{"ok":true}']);
    const result = await llm.invoke([new HumanMessage('ping')]);
    expect(result.content).toBe('{"ok":true}');
    expect(llm.calls).toHaveLength(1);
  });

  it('exposes quota exhaustion as an explicit LlmError QUOTA', () => {
    const budget = new LlmUsageBudget({ maxCalls: 1 });
    budget.consume();
    expect(() => {
      budget.consume();
    }).toThrow(LlmError);
    try {
      budget.consume();
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).kind).toBe('QUOTA');
    }
    const snap = budget.snapshot();
    expect(snap.exhausted).toBe(true);
    expect(snap.calls).toBe(1);
    expect(snap.maxCalls).toBe(1);
    expect(snap.deferredReason).toMatch(/esgotado/i);
  });

  it('createLlmProvider(fake) returns a usable model', async () => {
    const llm = createLlmProvider({
      provider: 'fake',
      fakeResponses: ['hola'],
    });
    const result = await llm.invoke([new HumanMessage('x')]);
    expect(result.content).toBe('hola');
  });
});

describe('LIVE-018 research adapters', () => {
  it('defaults to fake without Tavily key', () => {
    expect(resolveResearchProviderKind({ env: {} })).toBe('fake');
  });

  it('swaps to Tavily only when a key is present', () => {
    expect(
      resolveResearchProviderKind({
        env: { TAVILY_API_KEY: 'tvly-test-key' },
      }),
    ).toBe('tavily');
  });

  it('FakeResearchProvider serves offline corpus hits', async () => {
    const provider = createFakeResearchProvider({
      hits: [
        {
          title: 'Pix',
          url: 'https://www.bcb.gov.br/pix',
          content: 'trecho',
        },
      ],
      documents: {
        'https://www.bcb.gov.br/pix': {
          title: 'Pix',
          content: 'conteúdo longo do corpus'.repeat(20),
        },
      },
    });

    const hits = await provider.search('pix origem');
    expect(hits).toHaveLength(1);
    const doc = await provider.extract('https://www.bcb.gov.br/pix');
    expect(doc.content).toContain('conteúdo longo');
  });

  it('budget wrapper emits ResearchError QUOTA without inventing verdicts', async () => {
    const inner = createFakeResearchProvider({
      hits: [{ title: 'x', url: 'https://example.com/x' }],
    });
    const budget = new ResearchUsageBudget({ maxSearches: 1 });
    const provider = withResearchBudget(inner, budget);

    await provider.search('a');
    await expect(provider.search('b')).rejects.toMatchObject({
      name: 'ResearchError',
      kind: 'QUOTA',
    });
    expect(budget.snapshot().exhausted).toBe(true);
    expect(budget.snapshot().searches).toBe(1);
  });

  it('createResearchProvider(fake) never requires paid keys', async () => {
    const provider = createResearchProvider({ provider: 'fake', env: {} });
    await expect(provider.search('q')).resolves.toEqual([]);
  });

  it('createResearchProvider(tavily) fails explicitly without a key', () => {
    expect(() =>
      createResearchProvider({ provider: 'tavily', env: {} }),
    ).toThrow(ResearchError);
  });
});
