import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { LLMConfig } from '../types.js';
import { LlmError } from './errors.js';

/**
 * Low-level vendor constructors. Prefer {@link createLlmProvider} so the
 * analysis pipeline stays decoupled from Gemini/OpenAI specifics (LIVE-018).
 */
export const createLLM = (config: LLMConfig): BaseChatModel => {
  switch (config.provider) {
    case 'google':
      return new ChatGoogleGenerativeAI({
        model: config.model,
        temperature: config.temperature,
        apiKey: config.apiKey,
      });
    case 'openai':
      return new ChatOpenAI({
        modelName: config.model,
        temperature: config.temperature,
        apiKey: config.apiKey,
        ...(config.baseURL !== undefined ? { configuration: { baseURL: config.baseURL } } : {}),
      });
    default: {
      const _exhaustive: never = config.provider;
      throw new LlmError(
        'INVALID',
        `Provedor de LLM não suportado: ${String(_exhaustive)}`,
      );
    }
  }
};
