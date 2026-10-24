import { createFakeResearchProvider } from './fake.js';
import {
  createTavilyProvider,
  type TavilyProviderOptions,
} from './tavily.js';
import { ResearchError, type ResearchProvider } from './types.js';

/**
 * Swappable research backends (LIVE-018).
 *
 * - `tavily`: pilot search provider (free-tier friendly when the user supplies
 *   their own key via the setup UI — never auto-billed by this code).
 * - `fake`: offline corpus / tests / factual evals.
 * Additional search vendors remain P1 and plug into {@link ResearchProvider}.
 */
export type ResearchProviderKind = 'tavily' | 'fake';

export type ResolveResearchOptions = {
  provider?: ResearchProviderKind;
  apiKey?: string;
  tavily?: Omit<TavilyProviderOptions, 'apiKey'> & { apiKey?: string };
  fake?: Parameters<typeof createFakeResearchProvider>[0];
  env?: NodeJS.ProcessEnv;
};

function readEnv(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function resolveResearchProviderKind(
  options: ResolveResearchOptions = {},
): ResearchProviderKind {
  if (options.provider !== undefined) {
    return options.provider;
  }

  const env = options.env ?? process.env;
  const explicit = readEnv(env, [
    'RESEARCH_PROVIDER',
    'VERITAS_RESEARCH_PROVIDER',
  ])?.toLowerCase();
  if (explicit === 'tavily' || explicit === 'fake') {
    return explicit;
  }

  const apiKey =
    options.apiKey ??
    options.tavily?.apiKey ??
    readEnv(env, ['TAVILY_API_KEY']);
  return apiKey !== undefined ? 'tavily' : 'fake';
}

/**
 * Builds a research provider behind {@link ResearchProvider}. The evidence
 * engine never imports a vendor SDK; swapping providers does not change the
 * central pipeline.
 */
export function createResearchProvider(
  options: ResolveResearchOptions = {},
): ResearchProvider {
  const env = options.env ?? process.env;
  const kind = resolveResearchProviderKind(options);

  switch (kind) {
    case 'fake':
      return createFakeResearchProvider(options.fake ?? {});
    case 'tavily': {
      const apiKey =
        options.apiKey ??
        options.tavily?.apiKey ??
        readEnv(env, ['TAVILY_API_KEY']);
      if (apiKey === undefined || apiKey.length === 0) {
        throw new ResearchError(
          'INVALID',
          'Chave Tavily ausente: configure TAVILY_API_KEY ou use RESEARCH_PROVIDER=fake.',
        );
      }
      return createTavilyProvider({
        ...(options.tavily ?? {}),
        apiKey,
      });
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
