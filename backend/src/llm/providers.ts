import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMConfig } from '../types.js';
import {
  DEFAULT_ADVANCED_MODEL,
  DEFAULT_FAST_MODEL,
  DEFAULT_LOCAL_MODEL,
} from './config.js';
import { LlmError } from './errors.js';
import { createFakeLLM } from './fake.js';
import { createLLM } from './factory.js';

/**
 * Swappable LLM backends for the evidence engine (LIVE-018).
 *
 * - `local`: OpenAI-compatible endpoint (Ollama, LM Studio, vLLM…) — default
 *   free/open-source-friendly path when `OPENAI_BASE_URL` / `LLM_BASE_URL` is set.
 * - `google`: Gemini within free-tier quotas.
 * - `openai`: Cloud OpenAI (optional; never auto-billed by this code).
 * - `fake`: Deterministic offline replies for tests and factual evals.
 */
export type LlmProviderKind = 'local' | 'google' | 'openai' | 'fake';

export type ResolveLlmOptions = {
  /** Preferred provider; when omitted, inferred from env / available keys. */
  provider?: LlmProviderKind;
  apiKey?: string;
  model?: string;
  temperature?: number;
  /** OpenAI-compatible base URL for `local` (and optional openai proxies). */
  baseUrl?: string;
  /** Scripted replies when provider is `fake`. */
  fakeResponses?: readonly string[];
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

/**
 * Resolves the provider without requiring paid subscriptions. Prefer local
 * OpenAI-compatible endpoints, then Gemini free quota, then explicit fake.
 * Never enables automatic billing.
 */
export function resolveLlmProviderKind(
  options: ResolveLlmOptions = {},
): LlmProviderKind {
  if (options.provider !== undefined) {
    return options.provider;
  }

  const env = options.env ?? process.env;
  const explicit = readEnv(env, ['LLM_PROVIDER', 'VERITAS_LLM_PROVIDER'])
    ?.toLowerCase();
  if (
    explicit === 'local' ||
    explicit === 'google' ||
    explicit === 'openai' ||
    explicit === 'fake'
  ) {
    return explicit;
  }

  const baseUrl = options.baseUrl ?? readEnv(env, ['LLM_BASE_URL', 'OPENAI_BASE_URL']);
  if (baseUrl !== undefined) {
    return 'local';
  }

  const googleKey =
    options.apiKey ??
    readEnv(env, ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']);
  if (googleKey !== undefined) {
    return 'google';
  }

  const openaiKey = readEnv(env, ['OPENAI_API_KEY']);
  if (openaiKey !== undefined) {
    return 'openai';
  }

  // Offline-friendly default when no credentials are configured.
  return 'fake';
}

/**
 * Builds a chat model behind the shared {@link BaseChatModel} interface so the
 * analysis pipeline never imports a vendor SDK directly.
 */
export function createLlmProvider(options: ResolveLlmOptions = {}): BaseChatModel {
  const env = options.env ?? process.env;
  const kind = resolveLlmProviderKind(options);

  switch (kind) {
    case 'fake':
      return createFakeLLM(options.fakeResponses ?? []);
    case 'local': {
      const baseURL =
        options.baseUrl ??
        readEnv(env, ['LLM_BASE_URL', 'OPENAI_BASE_URL']) ??
        'http://127.0.0.1:11434/v1';
      const apiKey =
        options.apiKey ??
        readEnv(env, ['LLM_API_KEY', 'OPENAI_API_KEY']) ??
        'local-no-key';
      const config: LLMConfig = {
        ...DEFAULT_LOCAL_MODEL,
        provider: 'openai',
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        apiKey,
        baseURL,
      };
      return createLLM(config);
    }
    case 'google': {
      const apiKey =
        options.apiKey ??
        readEnv(env, [
          'GOOGLE_API_KEY',
          'GEMINI_API_KEY',
          'GOOGLE_GENERATIVE_AI_API_KEY',
        ]);
      if (apiKey === undefined || apiKey.length === 0) {
        throw new LlmError(
          'INVALID',
          'Chave Gemini ausente: configure GOOGLE_API_KEY ou use LLM_PROVIDER=local|fake.',
        );
      }
      const tier = readEnv(env, ['LLM_TIER']) === 'advanced'
        ? DEFAULT_ADVANCED_MODEL
        : DEFAULT_FAST_MODEL;
      return createLLM({
        ...tier,
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        apiKey,
      });
    }
    case 'openai': {
      const apiKey =
        options.apiKey ?? readEnv(env, ['OPENAI_API_KEY', 'LLM_API_KEY']);
      if (apiKey === undefined || apiKey.length === 0) {
        throw new LlmError(
          'INVALID',
          'Chave OpenAI ausente: configure OPENAI_API_KEY ou use LLM_PROVIDER=local|fake.',
        );
      }
      return createLLM({
        provider: 'openai',
        model: options.model ?? 'gpt-4o-mini',
        temperature: options.temperature ?? 0.1,
        apiKey,
        ...(options.baseUrl !== undefined ||
        readEnv(env, ['OPENAI_BASE_URL']) !== undefined
          ? {
              baseURL:
                options.baseUrl ?? readEnv(env, ['OPENAI_BASE_URL']),
            }
          : {}),
      });
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Fast-tier helper used by the text/live entrypoints. When a Gemini key is
 * supplied (setup UI), keeps the google adapter; otherwise falls back to the
 * free/local/fake resolution of {@link createLlmProvider}.
 */
export function getLiteLLM(
  apiKey?: string,
  options: Omit<ResolveLlmOptions, 'apiKey'> = {},
): BaseChatModel {
  const hasKey = apiKey !== undefined && apiKey.trim().length > 0;
  return createLlmProvider({
    ...options,
    ...(hasKey && options.provider === undefined
      ? { provider: 'google' as const }
      : {}),
    ...(hasKey ? { apiKey } : {}),
  });
}

/** Advanced-tier helper (Gemini advanced model when provider is google). */
export function getAdvancedLLM(
  apiKey?: string,
  options: Omit<ResolveLlmOptions, 'apiKey'> = {},
): BaseChatModel {
  const env = {
    ...(options.env ?? process.env),
    LLM_TIER: 'advanced',
  };
  const hasKey = apiKey !== undefined && apiKey.trim().length > 0;
  return createLlmProvider({
    ...options,
    env,
    ...(hasKey && options.provider === undefined
      ? { provider: 'google' as const }
      : {}),
    ...(hasKey ? { apiKey } : {}),
  });
}
