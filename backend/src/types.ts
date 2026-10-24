// Types
import { z } from 'zod';

export const LLM_CONFIG_SCHEMA = z.object({
  provider: z.enum(['openai', 'google']),
  model: z.string().min(1, 'Model name cannot be empty'),
  temperature: z.number().min(0).max(2),
  apiKey: z.string().optional(),
  /** OpenAI-compatible base URL (local Ollama/LM Studio/vLLM or proxies). */
  baseURL: z.url().optional(),
});

// Inferred types from schemas
export type LLMConfig = z.infer<typeof LLM_CONFIG_SCHEMA>;
