import { createHash } from 'node:crypto';
import type { AtomicClaim, Source, SourceType } from '@veritas/shared';
import {
  ResearchError,
  type ExtractedDocument,
  type ResearchErrorKind,
  type ResearchProvider,
  type SearchHit,
} from '#/research/index.js';

/** A search snippet never becomes a source: content must be inspected. */
export const MIN_DOCUMENT_CONTENT_CHARS = 200;
export const DEFAULT_MAX_RESULTS = 5;
export const DEFAULT_MAX_DOCUMENTS = 3;
export const DEFAULT_MAX_CONTENT_CHARS = 8000;
export const EXTRACTION_CONCURRENCY = 2;

/**
 * Structural view of the claim needed for retrieval, satisfied by the shared
 * `Claim` contract. Keeps the retriever usable with a single atomic claim.
 */
export type RetrievalClaim = {
  id: string;
  normalizedClaim: string;
  originalQuote?: string;
  atomicClaims?: readonly AtomicClaim[];
};

export type RetrievalFailure = {
  url: string;
  reason: string;
  /** Provider failure taxonomy, when the failure came from the provider. */
  kind?: ResearchErrorKind;
};

export type RetrievalResult = {
  sources: Source[];
  /** Inspected content per source id, kept for evidence evaluation. */
  documents: Record<string, string>;
  failures: RetrievalFailure[];
};

export type RetrieveEvidenceArgs = {
  claim: RetrievalClaim;
  provider: ResearchProvider;
  maxResults?: number;
  maxDocuments?: number;
  maxContentChars?: number;
  now?: () => Date;
  /** Propagated to the research provider (search + extract). */
  signal?: AbortSignal;
};

const PRIMARY_DOMAINS = [
  'bcb.gov.br',
  'planalto.gov.br',
  'senado.leg.br',
  'camara.leg.br',
  'ibge.gov.br',
  'gov.br',
] as const;

const SECONDARY_TOKENS = [
  'agencialupa',
  'aosfatos',
  'agenciapublica',
  'checagem',
] as const;

const PARTISAN_DOMAINS = [
  'pt.org.br',
  'psdb.org.br',
  'psol.org.br',
  'novo.org.br',
  'mdb.org.br',
  'progressistas.org.br',
  'podemos.org.br',
  'cidadania.org.br',
  'pcdob.org.br',
  'republicanos.org.br',
  'solidariedade.org.br',
] as const;

const PARTISAN_TOKENS = ['partido'] as const;

const FAILURE_REASON_BY_KIND: Record<ResearchErrorKind, string> = {
  QUOTA: 'cota do provedor de pesquisa esgotada',
  TIMEOUT: 'tempo esgotado ao recuperar o documento',
  TRANSIENT: 'falha temporária ao recuperar o documento',
  UNAVAILABLE: 'documento indisponível ou vazio',
  INVALID: 'resposta inválida do provedor de pesquisa',
};

export function buildSearchQuery(claim: RetrievalClaim): string {
  const atomic = claim.atomicClaims?.[0]?.proposition.trim() ?? '';
  if (atomic.length > 0) {
    return atomic;
  }
  const normalized = claim.normalizedClaim.trim();
  return normalized.length > 0
    ? normalized
    : (claim.originalQuote?.trim() ?? '');
}

export function canonicalizeUrl(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    parsed.hash = '';
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

const matchesDomain = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/** Publisher is the hostname without `www.`, never the model's guess. */
export function publisherFromUrl(url: string): string | undefined {
  const hostname = hostnameOf(url);
  return hostname !== undefined && hostname.length > 0 ? hostname : undefined;
}

export function classifySourceType(url: string): SourceType {
  const hostname = hostnameOf(url);
  if (hostname === undefined) {
    return 'OTHER';
  }
  if (PRIMARY_DOMAINS.some((domain) => matchesDomain(hostname, domain))) {
    return 'PRIMARY';
  }
  if (
    PARTISAN_DOMAINS.some((domain) => matchesDomain(hostname, domain)) ||
    PARTISAN_TOKENS.some((token) => hostname.includes(token))
  ) {
    return 'PARTISAN';
  }
  if (SECONDARY_TOKENS.some((token) => hostname.includes(token))) {
    return 'SECONDARY';
  }
  return 'OTHER';
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeContent(content: string, maxContentChars: number): string {
  const cleaned = content.replace(/\r\n/g, '\n').trim();
  return cleaned.slice(0, Math.max(maxContentChars, 0));
}

function normalizePublishedAt(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function describeFailure(url: string, error: unknown): RetrievalFailure {
  return error instanceof ResearchError
    ? { url, reason: FAILURE_REASON_BY_KIND[error.kind], kind: error.kind }
    : { url, reason: 'falha ao recuperar o documento' };
}

function dedupeHits(hits: readonly SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const unique: SearchHit[] = [];
  for (const hit of hits) {
    const canonical = canonicalizeUrl(hit.url);
    if (canonical === undefined || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    unique.push({ ...hit, url: canonical });
  }
  return unique;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

type ExtractionOutcome =
  | { hit: SearchHit; document: ExtractedDocument }
  | { hit: SearchHit; error: unknown };

function firstNonEmpty(...values: readonly (string | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return trimmed;
    }
  }
  return 'Documento sem título';
}

/**
 * Search -> dedupe -> extract (concurrency 2). Only documents with inspected
 * content become sources; snippets, failures and short pages are reported as
 * failures instead of being treated as evidence.
 */
export async function retrieveEvidence(
  args: RetrieveEvidenceArgs,
): Promise<RetrievalResult> {
  const { claim, provider } = args;
  const maxResults = args.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxDocuments = Math.max(args.maxDocuments ?? DEFAULT_MAX_DOCUMENTS, 0);
  const maxContentChars = args.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const accessedAt = (args.now ?? (() => new Date()))().toISOString();
  const signal = args.signal;

  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Evidence retrieval aborted');
  }

  const hits = await provider.search(buildSearchQuery(claim), {
    maxResults,
    signal,
  });
  const candidates = dedupeHits(hits).slice(0, maxDocuments);

  const outcomes = await mapWithConcurrency(
    candidates,
    EXTRACTION_CONCURRENCY,
    async (hit): Promise<ExtractionOutcome> => {
      try {
        if (signal?.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new Error('Evidence retrieval aborted');
        }
        const document = await provider.extract(hit.url, { signal });
        return { hit, document };
      } catch (error) {
        return { hit, error };
      }
    },
  );

  const sources: Source[] = [];
  const documents: Record<string, string> = {};
  const failures: RetrievalFailure[] = [];

  for (const outcome of outcomes) {
    if ('error' in outcome) {
      failures.push(describeFailure(outcome.hit.url, outcome.error));
      continue;
    }

    const content = normalizeContent(outcome.document.content, maxContentChars);
    if (content.length < MIN_DOCUMENT_CONTENT_CHARS) {
      failures.push({
        url: outcome.hit.url,
        reason: `conteúdo inspecionado insuficiente (menos de ${String(MIN_DOCUMENT_CONTENT_CHARS)} caracteres)`,
      });
      continue;
    }

    const publisher = publisherFromUrl(outcome.hit.url);
    if (publisher === undefined) {
      failures.push({
        url: outcome.hit.url,
        reason: 'URL inválida para identificar o publicador',
      });
      continue;
    }

    const publishedAt = normalizePublishedAt(
      outcome.document.publishedAt ?? outcome.hit.publishedAt,
    );

    const source: Source = {
      id: `src-${String(sources.length + 1)}`,
      title: firstNonEmpty(
        outcome.document.title,
        outcome.hit.title,
        publisher,
      ),
      publisher,
      url: outcome.hit.url,
      type: classifySourceType(outcome.hit.url),
      accessedAt,
      contentHash: contentHash(content),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    };

    sources.push(source);
    documents[source.id] = content;
  }

  // If every candidate failed at the provider boundary, preserve that as an
  // operational failure. An empty evidence set caused by provider outage is
  // not the same as a successful search that found no useful evidence.
  if (
    candidates.length > 0 &&
    sources.length === 0 &&
    failures.length === candidates.length &&
    failures.every((failure) => failure.kind !== undefined)
  ) {
    const kinds = failures.map((failure) => failure.kind);
    const kind = kinds.includes('QUOTA')
      ? 'QUOTA'
      : kinds.includes('TIMEOUT')
        ? 'TIMEOUT'
        : kinds.includes('TRANSIENT')
          ? 'TRANSIENT'
          : kinds.includes('INVALID')
            ? 'INVALID'
            : 'UNAVAILABLE';
    throw new ResearchError(
      kind,
      'Todos os documentos encontrados falharam ao serem recuperados pelo provedor de pesquisa.',
    );
  }

  return { sources, documents, failures };
}
