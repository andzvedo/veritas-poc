import { createHash } from 'node:crypto';
import type { Source } from '@veritas/shared';
import { SOURCE_SCHEMA } from '@veritas/shared';
import { describe, expect, it } from 'vitest';
import {
  buildSearchQuery,
  classifySourceType,
  retrieveEvidence,
} from '#/analysis/evidenceRetrieval.js';
import { ResearchError } from '#/research/types.js';
import type {
  ExtractedDocument,
  ResearchProvider,
  SearchHit,
  SearchOptions,
} from '#/research/types.js';

const LONG_CONTENT =
  'A Lei nº 12.865, de 9 de outubro de 2013, autorizou o Banco Central do Brasil a instituir o arranjo de pagamentos conhecido como Pix, disciplinando a gestão e o funcionamento do sistema. '.repeat(
    3,
  );

const CLAIM = {
  id: 'claim-1',
  normalizedClaim: 'O Pix foi criado em 2015.',
  originalQuote: 'O Pix foi criado em 2015.',
  atomicClaims: [{ id: 'atomic-1', proposition: 'O Pix foi criado em 2015' }],
};

type ProviderConfig = {
  hits: SearchHit[];
  documents: Record<string, string | Error | undefined>;
  titles?: Record<string, string>;
  searchError?: Error;
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

class FakeProvider implements ResearchProvider {
  readonly queries: { query: string; options?: SearchOptions }[] = [];
  readonly extractedUrls: string[] = [];
  active = 0;
  maxConcurrent = 0;

  constructor(private readonly config: ProviderConfig) {}

  search(query: string, options?: SearchOptions): Promise<SearchHit[]> {
    this.queries.push({ query, options });
    const error = this.config.searchError;
    return error === undefined
      ? Promise.resolve(this.config.hits)
      : Promise.reject(error);
  }

  async extract(url: string): Promise<ExtractedDocument> {
    this.extractedUrls.push(url);
    this.active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    await delay(5);
    this.active -= 1;

    const entry = this.config.documents[url];
    if (entry === undefined) {
      throw new ResearchError('UNAVAILABLE', 'documento ausente');
    }
    if (entry instanceof Error) {
      throw entry;
    }

    const document: ExtractedDocument = { url, content: entry };
    const title = this.config.titles?.[url];
    if (title !== undefined) {
      document.title = title;
    }
    return document;
  }
}

const hit = (url: string, title = 'Documento'): SearchHit => ({ title, url });

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => error);
}

describe('buildSearchQuery', () => {
  it('prefers the atomic proposition and falls back to the normalized claim', () => {
    expect(buildSearchQuery(CLAIM)).toBe('O Pix foi criado em 2015');
    expect(
      buildSearchQuery({
        id: 'claim-2',
        normalizedClaim: '  O Pix foi criado em 2015.  ',
      }),
    ).toBe('O Pix foi criado em 2015.');
    expect(
      buildSearchQuery({
        id: 'claim-3',
        normalizedClaim: '',
        originalQuote: 'Pix foi criado em 2015',
      }),
    ).toBe('Pix foi criado em 2015');
  });
});

describe('classifySourceType', () => {
  it('separates primary, secondary, partisan and other sources', () => {
    expect(classifySourceType('https://www.bcb.gov.br/x')).toBe('PRIMARY');
    expect(
      classifySourceType('https://www.planalto.gov.br/ccivil_03/lei'),
    ).toBe('PRIMARY');
    expect(classifySourceType('https://www.aosfatos.org/noticias/x')).toBe(
      'SECONDARY',
    );
    expect(classifySourceType('https://agencialupa.org/x')).toBe('SECONDARY');
    expect(classifySourceType('https://pt.org.br/nota')).toBe('PARTISAN');
    expect(classifySourceType('https://www.psol.org.br/nota')).toBe('PARTISAN');
    expect(classifySourceType('https://noticias.uol.com.br/x')).toBe('OTHER');
    expect(classifySourceType('not a url')).toBe('OTHER');
  });
});

describe('retrieveEvidence', () => {
  it('dedupes urls before extracting and keeps source ids sequential', async () => {
    const url = 'https://www.bcb.gov.br/estabilidadefinanceira/pix';
    const provider = new FakeProvider({
      hits: [hit(url), hit(url, 'Duplicado'), hit(`${url}#secao`)],
      documents: { [url]: LONG_CONTENT },
      titles: { [url]: 'Resolução Pix' },
    });

    const result = await retrieveEvidence({
      claim: CLAIM,
      provider,
      now: () => new Date('2025-01-10T12:00:00.000Z'),
    });

    expect(provider.queries[0].query).toBe('O Pix foi criado em 2015');
    expect(provider.extractedUrls).toEqual([url]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      id: 'src-1',
      title: 'Resolução Pix',
      publisher: 'bcb.gov.br',
      url,
      type: 'PRIMARY',
      accessedAt: '2025-01-10T12:00:00.000Z',
    });
    expect(result.failures).toEqual([]);
  });

  it('skips inaccessible and short documents instead of treating snippets as sources', async () => {
    const provider = new FakeProvider({
      hits: [
        hit('https://www.bcb.gov.br/a', 'Acessível'),
        hit('https://www.bcb.gov.br/b', 'Indisponível'),
        hit('https://www.bcb.gov.br/c', 'Curto'),
      ],
      documents: {
        'https://www.bcb.gov.br/a': LONG_CONTENT,
        'https://www.bcb.gov.br/b': new ResearchError(
          'UNAVAILABLE',
          'documento indisponível',
        ),
        'https://www.bcb.gov.br/c':
          'Snippet curto, sem conteúdo inspecionável.',
      },
    });

    const result = await retrieveEvidence({ claim: CLAIM, provider });

    expect(result.sources.map((source) => source.id)).toEqual(['src-1']);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].url).toBe('https://www.bcb.gov.br/b');
    expect(result.failures[0].reason).toBe('documento indisponível ou vazio');
    expect(result.failures[0].kind).toBe('UNAVAILABLE');
    expect(result.failures[1].url).toBe('https://www.bcb.gov.br/c');
    expect(result.failures[1].reason).toContain('insuficiente');
    expect(result.failures[1].kind).toBeUndefined();
  });

  it('rejects a document whose inspected content is only a snippet', async () => {
    const url = 'https://example.org/a';
    const provider = new FakeProvider({
      hits: [{ ...hit(url), content: LONG_CONTENT }],
      documents: { [url]: 'Trecho mínimo.' },
    });

    const result = await retrieveEvidence({ claim: CLAIM, provider });

    expect(result.sources).toEqual([]);
    expect(result.documents).toEqual({});
    expect(result.failures[0].reason).toContain('insuficiente');
  });

  it('respects maxDocuments', async () => {
    const urls = Array.from(
      { length: 5 },
      (_value, index) => `https://example.org/doc-${String(index + 1)}`,
    );
    const provider = new FakeProvider({
      hits: urls.map((url) => hit(url)),
      documents: Object.fromEntries(
        urls.map((url) => [url, LONG_CONTENT] as const),
      ),
    });

    const result = await retrieveEvidence({
      claim: CLAIM,
      provider,
      maxDocuments: 2,
    });

    expect(provider.extractedUrls).toHaveLength(2);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => source.id)).toEqual([
      'src-1',
      'src-2',
    ]);
  });

  it('classifies publishers and validates the Source contract', async () => {
    const urls = [
      'https://www.bcb.gov.br/x',
      'https://www.aosfatos.org/noticias/x',
      'https://pt.org.br/nota',
      'https://noticias.uol.com.br/x',
    ];
    const provider = new FakeProvider({
      hits: urls.map((url) => hit(url)),
      documents: Object.fromEntries(
        urls.map((url) => [url, LONG_CONTENT] as const),
      ),
    });

    const result = await retrieveEvidence({
      claim: CLAIM,
      provider,
      maxDocuments: 4,
      now: () => new Date('2025-01-10T12:00:00.000Z'),
    });

    expect(result.sources.map((source) => source.type)).toEqual([
      'PRIMARY',
      'SECONDARY',
      'PARTISAN',
      'OTHER',
    ]);
    expect(result.sources.map((source) => source.publisher)).toEqual([
      'bcb.gov.br',
      'aosfatos.org',
      'pt.org.br',
      'noticias.uol.com.br',
    ]);
    expect(
      result.sources.map(
        (source: Source) => SOURCE_SCHEMA.safeParse(source).success,
      ),
    ).toEqual([true, true, true, true]);
  });

  it('keeps publishedAt only when the provider supplies a valid date', async () => {
    const provider = new FakeProvider({
      hits: [
        {
          ...hit('https://example.org/dated'),
          publishedAt: 'Mon, 05 Nov 2020 00:00:00 GMT',
        },
        {
          ...hit('https://example.org/invalid'),
          publishedAt: 'data desconhecida',
        },
        hit('https://example.org/undated'),
      ],
      documents: {
        'https://example.org/dated': LONG_CONTENT,
        'https://example.org/invalid': LONG_CONTENT,
        'https://example.org/undated': LONG_CONTENT,
      },
    });

    const result = await retrieveEvidence({
      claim: CLAIM,
      provider,
      maxDocuments: 3,
    });

    expect(result.sources[0].publishedAt).toBe('2020-11-05T00:00:00.000Z');
    expect(result.sources[1].publishedAt).toBeUndefined();
    expect(result.sources[2].publishedAt).toBeUndefined();
  });

  it('caps inspected content and hashes the capped text', async () => {
    const url = 'https://example.org/long';
    const provider = new FakeProvider({
      hits: [hit(url)],
      documents: { [url]: LONG_CONTENT },
    });

    const result = await retrieveEvidence({
      claim: CLAIM,
      provider,
      maxContentChars: 300,
    });

    const content = result.documents['src-1'];
    expect(content).toHaveLength(300);
    const expectedHash = createHash('sha256')
      .update(content, 'utf8')
      .digest('hex');
    expect(result.sources[0].contentHash).toBe(expectedHash);
  });

  it('extracts with concurrency 2', async () => {
    const urls = Array.from(
      { length: 4 },
      (_value, index) => `https://example.org/conc-${String(index + 1)}`,
    );
    const provider = new FakeProvider({
      hits: urls.map((url) => hit(url)),
      documents: Object.fromEntries(
        urls.map((url) => [url, LONG_CONTENT] as const),
      ),
    });

    const result = await retrieveEvidence({
      claim: CLAIM,
      provider,
      maxDocuments: 4,
    });

    expect(provider.maxConcurrent).toBe(2);
    expect(result.sources).toHaveLength(4);
  });

  it('preserves total document-provider outages as operational errors without leaking credentials', async () => {
    const provider = new FakeProvider({
      hits: [hit('https://example.org/secret')],
      documents: {
        'https://example.org/secret': new ResearchError(
          'UNAVAILABLE',
          'falha com a chave tvly-secret-key-123456',
        ),
      },
    });

    const error = await captureError(retrieveEvidence({ claim: CLAIM, provider }));

    expect(error).toBeInstanceOf(ResearchError);
    expect((error as ResearchError).kind).toBe('UNAVAILABLE');
    expect((error as Error).message).not.toContain('tvly-secret-key');
  });

  it('returns an empty result when the search finds nothing', async () => {
    const provider = new FakeProvider({ hits: [], documents: {} });

    const result = await retrieveEvidence({ claim: CLAIM, provider });

    expect(result).toEqual({ sources: [], documents: {}, failures: [] });
  });

  it('propagates provider failures from the search stage', async () => {
    const provider = new FakeProvider({
      hits: [],
      documents: {},
      searchError: new ResearchError('QUOTA', 'cota esgotada'),
    });

    const error = await captureError(
      retrieveEvidence({ claim: CLAIM, provider }),
    );

    expect(error).toBeInstanceOf(ResearchError);
    expect((error as ResearchError).kind).toBe('QUOTA');
  });

  it('forwards maxResults to the provider', async () => {
    const provider = new FakeProvider({ hits: [], documents: {} });

    await retrieveEvidence({ claim: CLAIM, provider, maxResults: 3 });

    expect(provider.queries[0].options?.maxResults).toBe(3);
  });
});
