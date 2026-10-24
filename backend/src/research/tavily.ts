import { isSafeExternalUrl } from '#/utils/security.js';
import {
  ResearchError,
  redactSecrets,
  summarizeText,
  type ExtractedDocument,
  type ExtractOptions,
  type ResearchProvider,
  type SearchHit,
  type SearchOptions,
} from './types.js';

export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com';
export const RESEARCH_DEFAULT_TIMEOUT_MS = 20_000;
export const TAVILY_DEFAULT_MAX_RESULTS = 5;

const MAX_SEARCH_RESULTS = 20;
const ERROR_DETAIL_MAX_CHARS = 160;

const QUOTA_STATUS_CODES = new Set([429, 432, 433]);
const UNAVAILABLE_STATUS_CODES = new Set([401, 403, 404, 410]);

export type TavilyProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injected in tests; defaults to the runtime `fetch`. */
  fetchImpl?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): JsonRecord | undefined =>
  isRecord(value) ? value : undefined;

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Public http(s) destinations only (SSRF policy, LIVE-038). */
function isHttpUrl(value: string): boolean {
  return isSafeExternalUrl(value);
}

function normalizeMaxResults(value: number): number {
  if (!Number.isFinite(value)) {
    return TAVILY_DEFAULT_MAX_RESULTS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_SEARCH_RESULTS);
}

function readTimeoutFromEnv(): number {
  const raw = process.env['RESEARCH_TIMEOUT_MS'];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : RESEARCH_DEFAULT_TIMEOUT_MS;
}

/**
 * Tavily REST adapter. Uses the platform `fetch` (no vendor SDK) so providers
 * remain swappable, and keeps the API key out of every error message.
 */
export class TavilyResearchProvider implements ResearchProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: TavilyProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new ResearchError(
        'INVALID',
        'Chave da API de pesquisa ausente ou vazia.',
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = (
      options.baseUrl ??
      process.env['TAVILY_BASE_URL'] ??
      TAVILY_DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? readTimeoutFromEnv();
    this.fetchImpl = options.fetchImpl;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      throw new ResearchError('INVALID', 'Consulta de pesquisa vazia.');
    }

    const payload = await this.post(
      '/search',
      {
        api_key: this.apiKey,
        query: trimmedQuery,
        max_results: normalizeMaxResults(
          opts.maxResults ?? TAVILY_DEFAULT_MAX_RESULTS,
        ),
        search_depth: 'advanced',
        include_answer: false,
        include_raw_content: false,
      },
      opts.signal,
    );

    return parseSearchPayload(payload);
  }

  async extract(
    url: string,
    opts: ExtractOptions = {},
  ): Promise<ExtractedDocument> {
    const target = url.trim();
    if (!isHttpUrl(target)) {
      throw new ResearchError('INVALID', 'URL de documento inválida.');
    }

    const payload = await this.post(
      '/extract',
      {
        api_key: this.apiKey,
        urls: [target],
        extract_depth: 'basic',
      },
      opts.signal,
    );

    return parseExtractPayload(payload, target);
  }

  private async post(
    path: string,
    body: JsonRecord,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const controller = new AbortController();
    const forwardAbort = () => {
      controller.abort();
    };

    if (signal !== undefined) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', forwardAbort, { once: true });
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    // The timer rejects on its own so a provider that ignores AbortSignal
    // cannot stall the pipeline.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new ResearchError(
            'TIMEOUT',
            `Tempo esgotado (${String(this.timeoutMs)} ms) ao consultar o provedor de pesquisa.`,
          ),
        );
      }, this.timeoutMs);
    });

    const fetchFn = this.fetchImpl ?? globalThis.fetch.bind(globalThis);

    try {
      const response = await Promise.race([
        fetchFn(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        timeout,
      ]);

      if (!response.ok) {
        throw this.httpError(response.status, await readBody(response));
      }

      return await readJsonBody(response);
    } catch (error) {
      if (error instanceof ResearchError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new ResearchError(
          'TIMEOUT',
          'A consulta ao provedor de pesquisa foi interrompida por tempo limite ou cancelamento.',
          { cause: error },
        );
      }
      throw new ResearchError(
        'TRANSIENT',
        'Falha de rede ao consultar o provedor de pesquisa.',
        { cause: error },
      );
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private httpError(status: number, body: string): ResearchError {
    const detail = summarizeText(
      redactSecrets(body, [this.apiKey]),
      ERROR_DETAIL_MAX_CHARS,
    );
    const suffix = detail.length > 0 ? ` Detalhe: ${detail}` : '';

    if (QUOTA_STATUS_CODES.has(status)) {
      return new ResearchError(
        'QUOTA',
        `Cota do provedor de pesquisa esgotada (HTTP ${String(status)}).${suffix}`,
        { status },
      );
    }
    if (status >= 500) {
      return new ResearchError(
        'TRANSIENT',
        `Provedor de pesquisa indisponível (HTTP ${String(status)}).${suffix}`,
        { status },
      );
    }
    if (UNAVAILABLE_STATUS_CODES.has(status)) {
      return new ResearchError(
        'UNAVAILABLE',
        `Provedor de pesquisa recusou a requisição (HTTP ${String(status)}).${suffix}`,
        { status },
      );
    }
    return new ResearchError(
      'INVALID',
      `Requisição inválida ao provedor de pesquisa (HTTP ${String(status)}).${suffix}`,
      { status },
    );
  }
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const body = await readBody(response);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ResearchError(
      'INVALID',
      'Resposta inválida do provedor de pesquisa.',
    );
  }
}

function parseSearchPayload(payload: unknown): SearchHit[] {
  const record = asRecord(payload);
  const results = record?.['results'];
  if (!Array.isArray(results)) {
    throw new ResearchError(
      'INVALID',
      'Resposta de pesquisa sem lista de resultados.',
    );
  }

  const hits: SearchHit[] = [];
  for (const item of results) {
    const entry = asRecord(item);
    if (entry === undefined) {
      continue;
    }
    const url = readString(entry['url']);
    const title = readString(entry['title']);
    if (url === undefined || title === undefined || !isHttpUrl(url)) {
      continue;
    }

    const hit: SearchHit = { title, url };
    const content = readString(entry['content']);
    if (content !== undefined) {
      hit.content = content;
    }
    const score = readNumber(entry['score']);
    if (score !== undefined) {
      hit.score = score;
    }
    const publishedAt =
      readString(entry['published_date']) ?? readString(entry['publishedAt']);
    if (publishedAt !== undefined) {
      hit.publishedAt = publishedAt;
    }
    hits.push(hit);
  }

  return hits;
}

function parseExtractPayload(
  payload: unknown,
  requestedUrl: string,
): ExtractedDocument {
  const record = asRecord(payload);
  if (record === undefined) {
    throw new ResearchError(
      'INVALID',
      'Resposta de extração inválida do provedor de pesquisa.',
    );
  }

  const results = record['results'];
  if (Array.isArray(results)) {
    for (const item of results) {
      const entry = asRecord(item);
      if (entry === undefined) {
        continue;
      }
      const content = readString(entry['raw_content'] ?? entry['content']);
      if (content === undefined) {
        continue;
      }
      const document: ExtractedDocument = {
        url: readString(entry['url']) ?? requestedUrl,
        content,
      };
      const title = readString(entry['title']);
      if (title !== undefined) {
        document.title = title;
      }
      const publishedAt =
        readString(entry['published_date']) ?? readString(entry['publishedAt']);
      if (publishedAt !== undefined) {
        document.publishedAt = publishedAt;
      }
      return document;
    }
  }

  if (!Array.isArray(results) && !Array.isArray(record['failed_results'])) {
    throw new ResearchError('INVALID', 'Resposta de extração sem resultados.');
  }

  throw new ResearchError(
    'UNAVAILABLE',
    'Não foi possível extrair o conteúdo do documento.',
  );
}

export function createTavilyProvider(
  options: TavilyProviderOptions,
): TavilyResearchProvider {
  return new TavilyResearchProvider(options);
}

/** Convenience factory for pipelines that resolve credentials from env. */
export function createTavilyProviderFromEnv(
  options: Omit<TavilyProviderOptions, 'apiKey'> & { apiKey?: string } = {},
): TavilyResearchProvider {
  return new TavilyResearchProvider({
    ...options,
    apiKey: options.apiKey ?? process.env['TAVILY_API_KEY'] ?? '',
  });
}
