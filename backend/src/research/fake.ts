import { ResearchError } from './types.js';
import type {
  ExtractedDocument,
  ExtractOptions,
  ResearchProvider,
  SearchHit,
  SearchOptions,
} from './types.js';

export type FakeResearchDocument = {
  content: string;
  title?: string;
  publishedAt?: string;
};

export type FakeResearchProviderOptions = {
  /** Search hits returned for every query (or keyed by exact query). */
  hits?: readonly SearchHit[] | Readonly<Record<string, readonly SearchHit[]>>;
  /** Extractable documents keyed by URL. */
  documents?: Readonly<Record<string, FakeResearchDocument | string>>;
  /** Optional errors forced on search / extract. */
  searchError?: ResearchError;
  extractErrors?: ReadonlyMap<string, ResearchError>;
};

function isHitList(
  value: readonly SearchHit[] | Readonly<Record<string, readonly SearchHit[]>>,
): value is readonly SearchHit[] {
  return Array.isArray(value);
}

/**
 * In-memory research provider for tests and offline factual evals. Never
 * contacts Tavily or any paid API (LIVE-018 / LIVE-024).
 */
export class FakeResearchProvider implements ResearchProvider {
  readonly queries: { query: string; options?: SearchOptions }[] = [];
  readonly extractedUrls: string[] = [];

  private readonly hits:
    | readonly SearchHit[]
    | Readonly<Record<string, readonly SearchHit[]>>;
  private readonly documents: Readonly<
    Record<string, FakeResearchDocument | string>
  >;
  private readonly searchError: ResearchError | undefined;
  private readonly extractErrors: ReadonlyMap<string, ResearchError>;

  constructor(options: FakeResearchProviderOptions = {}) {
    this.hits = options.hits ?? [];
    this.documents = options.documents ?? {};
    this.searchError = options.searchError;
    this.extractErrors = options.extractErrors ?? new Map();
  }

  search(query: string, options?: SearchOptions): Promise<SearchHit[]> {
    this.queries.push({ query, options });
    if (this.searchError !== undefined) {
      return Promise.reject(this.searchError);
    }

    const hits = this.hits;
    if (isHitList(hits)) {
      return Promise.resolve([...hits]);
    }

    const trimmed = query.trim();
    const byQuery = Object.prototype.hasOwnProperty.call(hits, trimmed)
      ? hits[trimmed]
      : undefined;
    const byWildcard = Object.prototype.hasOwnProperty.call(hits, '*')
      ? hits['*']
      : undefined;
    return Promise.resolve([...(byQuery ?? byWildcard ?? [])]);
  }

  extract(url: string, opts?: ExtractOptions): Promise<ExtractedDocument> {
    void opts;
    this.extractedUrls.push(url);
    const forced = this.extractErrors.get(url);
    if (forced !== undefined) {
      return Promise.reject(forced);
    }

    const documents = new Map(Object.entries(this.documents));
    const entry = documents.get(url);
    if (entry === undefined) {
      return Promise.reject(
        new ResearchError(
          'UNAVAILABLE',
          'Documento ausente no corpus offline de pesquisa.',
        ),
      );
    }

    if (typeof entry === 'string') {
      return Promise.resolve({ url, content: entry });
    }

    const document: ExtractedDocument = { url, content: entry.content };
    if (entry.title !== undefined) {
      document.title = entry.title;
    }
    if (entry.publishedAt !== undefined) {
      document.publishedAt = entry.publishedAt;
    }
    return Promise.resolve(document);
  }
}

export function createFakeResearchProvider(
  options: FakeResearchProviderOptions = {},
): FakeResearchProvider {
  return new FakeResearchProvider(options);
}
