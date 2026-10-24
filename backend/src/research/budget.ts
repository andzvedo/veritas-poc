import { ResearchError } from './types.js';
import type {
  ExtractedDocument,
  ExtractOptions,
  ResearchProvider,
  SearchHit,
  SearchOptions,
} from './types.js';

/**
 * Session-scoped research usage limits. Exhaustion throws ResearchError QUOTA
 * so the pipeline can emit DEFERRED without inventing a factual verdict.
 */
export type ResearchBudgetOptions = {
  maxSearches?: number;
  maxExtracts?: number;
  /** Combined search+extract cap when set. */
  maxCalls?: number;
  /** Soft credit estimate; each search/extract costs creditsPerCall. */
  maxCredits?: number;
  creditsPerCall?: number;
};

export type ResearchUsageSnapshot = {
  searches: number;
  extracts: number;
  calls: number;
  estimatedCredits: number;
  maxSearches: number | undefined;
  maxExtracts: number | undefined;
  maxCalls: number | undefined;
  maxCredits: number | undefined;
  remainingSearches: number | undefined;
  remainingExtracts: number | undefined;
  remainingCalls: number | undefined;
  remainingCredits: number | undefined;
  exhausted: boolean;
  deferredReason: string | undefined;
};

export class ResearchUsageBudget {
  private searches = 0;
  private extracts = 0;
  private estimatedCredits = 0;
  private exhaustedReason: string | undefined;
  private readonly maxSearches: number | undefined;
  private readonly maxExtracts: number | undefined;
  private readonly maxCalls: number | undefined;
  private readonly maxCredits: number | undefined;
  private readonly creditsPerCall: number;

  constructor(options: ResearchBudgetOptions = {}) {
    this.maxSearches = options.maxSearches;
    this.maxExtracts = options.maxExtracts;
    this.maxCalls = options.maxCalls;
    this.maxCredits = options.maxCredits;
    this.creditsPerCall = options.creditsPerCall ?? 1;
  }

  snapshot(): ResearchUsageSnapshot {
    const calls = this.searches + this.extracts;
    return {
      searches: this.searches,
      extracts: this.extracts,
      calls,
      estimatedCredits: this.estimatedCredits,
      maxSearches: this.maxSearches,
      maxExtracts: this.maxExtracts,
      maxCalls: this.maxCalls,
      maxCredits: this.maxCredits,
      remainingSearches:
        this.maxSearches === undefined
          ? undefined
          : Math.max(this.maxSearches - this.searches, 0),
      remainingExtracts:
        this.maxExtracts === undefined
          ? undefined
          : Math.max(this.maxExtracts - this.extracts, 0),
      remainingCalls:
        this.maxCalls === undefined
          ? undefined
          : Math.max(this.maxCalls - calls, 0),
      remainingCredits:
        this.maxCredits === undefined
          ? undefined
          : Math.max(this.maxCredits - this.estimatedCredits, 0),
      exhausted: this.exhaustedReason !== undefined,
      deferredReason: this.exhaustedReason,
    };
  }

  consumeSearch(): void {
    this.consume('search');
  }

  consumeExtract(): void {
    this.consume('extract');
  }

  private consume(kind: 'search' | 'extract'): void {
    if (this.exhaustedReason !== undefined) {
      throw new ResearchError('QUOTA', this.exhaustedReason);
    }

    const nextSearches = this.searches + (kind === 'search' ? 1 : 0);
    const nextExtracts = this.extracts + (kind === 'extract' ? 1 : 0);
    const nextCalls = nextSearches + nextExtracts;
    const nextCredits = this.estimatedCredits + this.creditsPerCall;

    if (this.maxSearches !== undefined && nextSearches > this.maxSearches) {
      this.exhaustedReason = `Orçamento de pesquisa esgotado: limite de ${String(this.maxSearches)} busca(s) atingido.`;
      throw new ResearchError('QUOTA', this.exhaustedReason);
    }
    if (this.maxExtracts !== undefined && nextExtracts > this.maxExtracts) {
      this.exhaustedReason = `Orçamento de pesquisa esgotado: limite de ${String(this.maxExtracts)} extração(ões) atingido.`;
      throw new ResearchError('QUOTA', this.exhaustedReason);
    }
    if (this.maxCalls !== undefined && nextCalls > this.maxCalls) {
      this.exhaustedReason = `Orçamento de pesquisa esgotado: limite de ${String(this.maxCalls)} chamada(s) atingido.`;
      throw new ResearchError('QUOTA', this.exhaustedReason);
    }
    if (this.maxCredits !== undefined && nextCredits > this.maxCredits) {
      this.exhaustedReason = `Orçamento de pesquisa esgotado: limite de ${String(this.maxCredits)} crédito(s) atingido.`;
      throw new ResearchError('QUOTA', this.exhaustedReason);
    }

    this.searches = nextSearches;
    this.extracts = nextExtracts;
    this.estimatedCredits = nextCredits;
  }
}

/**
 * Decorates any {@link ResearchProvider} with a shared usage budget. The
 * central evidence engine keeps depending only on the interface.
 */
export class BudgetedResearchProvider implements ResearchProvider {
  constructor(
    private readonly inner: ResearchProvider,
    private readonly budget: ResearchUsageBudget,
  ) {}

  async search(query: string, opts?: SearchOptions): Promise<SearchHit[]> {
    this.budget.consumeSearch();
    return this.inner.search(query, opts);
  }

  async extract(
    url: string,
    opts?: ExtractOptions,
  ): Promise<ExtractedDocument> {
    this.budget.consumeExtract();
    return this.inner.extract(url, opts);
  }
}

export function withResearchBudget(
  provider: ResearchProvider,
  budget: ResearchUsageBudget,
): BudgetedResearchProvider {
  return new BudgetedResearchProvider(provider, budget);
}
