import { LLMConfig } from '../types.js';

// LLM Models Configuration
// - gemini-2.5-*: blocked for new API keys
// - gemini-3.8-flash: often 503 (high demand) → LangChain retries look like a hang
// Prefer currently available Flash models for this PoC.
// See: https://ai.google.dev/gemini-api/docs/models
export const DEFAULT_FAST_MODEL: LLMConfig = {
  provider: 'google',
  model: 'gemini-3.5-flash-lite',
  temperature: 0.1,
};

export const DEFAULT_ADVANCED_MODEL: LLMConfig = {
  provider: 'google',
  model: 'gemini-3.6-flash',
  temperature: 0.1,
};

/**
 * Free/open-source-friendly default: OpenAI-compatible local endpoint
 * (Ollama, LM Studio, vLLM…). No paid subscription required (LIVE-018).
 */
export const DEFAULT_LOCAL_MODEL: LLMConfig = {
  provider: 'openai',
  model: 'llama3.2',
  temperature: 0.1,
  baseURL: 'http://127.0.0.1:11434/v1',
};
