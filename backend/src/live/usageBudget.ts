import {
  LlmUsageBudget,
  type LlmBudgetOptions,
} from '#/llm/budget.js';
import {
  ResearchUsageBudget,
  type ResearchBudgetOptions,
} from '#/research/budget.js';

/** Finite per-session defaults; estimates are counters, not provider billing. */
export const DEFAULT_LIVE_LLM_BUDGET: Required<LlmBudgetOptions> = {
  maxCalls: 200,
  maxCredits: 200,
  creditsPerCall: 1,
};

export const DEFAULT_LIVE_RESEARCH_BUDGET: Required<ResearchBudgetOptions> = {
  maxSearches: 60,
  maxExtracts: 120,
  maxCalls: 180,
  maxCredits: 180,
  creditsPerCall: 1,
};

export type LiveUsageBudgetOptions = {
  llm?: LlmBudgetOptions;
  research?: ResearchBudgetOptions;
};

export type LiveUsageBudgets = {
  llm: LlmUsageBudget;
  research: ResearchUsageBudget;
};

function readLimit(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function liveUsageBudgetOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LiveUsageBudgetOptions {
  return {
    llm: {
      maxCalls: readLimit(
        env,
        'LIVE_LLM_MAX_CALLS',
        DEFAULT_LIVE_LLM_BUDGET.maxCalls,
      ),
      maxCredits: readLimit(
        env,
        'LIVE_LLM_MAX_CREDITS',
        DEFAULT_LIVE_LLM_BUDGET.maxCredits,
      ),
      creditsPerCall: 1,
    },
    research: {
      maxSearches: readLimit(
        env,
        'LIVE_RESEARCH_MAX_SEARCHES',
        DEFAULT_LIVE_RESEARCH_BUDGET.maxSearches,
      ),
      maxExtracts: readLimit(
        env,
        'LIVE_RESEARCH_MAX_EXTRACTS',
        DEFAULT_LIVE_RESEARCH_BUDGET.maxExtracts,
      ),
      maxCalls: readLimit(
        env,
        'LIVE_RESEARCH_MAX_CALLS',
        DEFAULT_LIVE_RESEARCH_BUDGET.maxCalls,
      ),
      maxCredits: readLimit(
        env,
        'LIVE_RESEARCH_MAX_CREDITS',
        DEFAULT_LIVE_RESEARCH_BUDGET.maxCredits,
      ),
      creditsPerCall: 1,
    },
  };
}

export function createLiveUsageBudgets(
  options: LiveUsageBudgetOptions = liveUsageBudgetOptionsFromEnv(),
): LiveUsageBudgets {
  return {
    llm: new LlmUsageBudget(options.llm),
    research: new ResearchUsageBudget(options.research),
  };
}
