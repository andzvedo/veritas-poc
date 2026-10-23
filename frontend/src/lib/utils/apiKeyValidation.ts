/**
 * Validação client-side dos formatos conhecidos de API keys do Veritas.
 *
 * Google Gemini (AI Studio):
 * - Standard: `AIzaSy...` (39 chars) — formato clássico
 * - Authorization: `AQ....` — formato atual do AI Studio (auth keys)
 *
 * Tavily:
 * - `tvly-...`, `tvly-dev-...`, `tvly-prod-...`
 */

const GEMINI_STANDARD_KEY = /^AIza[0-9A-Za-z_-]{35}$/;
const GEMINI_AUTH_KEY = /^AQ\.[A-Za-z0-9_-]{20,}$/;
const TAVILY_KEY = /^tvly-(?:(?:dev|prod)-)?[A-Za-z0-9_-]{16,}$/;

export function isValidGeminiApiKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  return GEMINI_STANDARD_KEY.test(trimmed) || GEMINI_AUTH_KEY.test(trimmed);
}

export function isValidTavilyApiKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  return TAVILY_KEY.test(trimmed);
}

export function isValidGoogleApiKey(key: string): boolean {
  return isValidGeminiApiKey(key);
}
