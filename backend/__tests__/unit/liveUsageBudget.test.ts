import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_LLM_BUDGET,
  DEFAULT_LIVE_RESEARCH_BUDGET,
  liveUsageBudgetOptionsFromEnv,
} from '#/live/usageBudget.js';

describe('live usage budget configuration', () => {
  it('uses finite per-session defaults', () => {
    const options = liveUsageBudgetOptionsFromEnv({});
    expect(options.llm).toMatchObject(DEFAULT_LIVE_LLM_BUDGET);
    expect(options.research).toMatchObject(DEFAULT_LIVE_RESEARCH_BUDGET);
  });

  it('accepts non-negative integer overrides and ignores invalid values', () => {
    const options = liveUsageBudgetOptionsFromEnv({
      LIVE_LLM_MAX_CALLS: '0',
      LIVE_LLM_MAX_CREDITS: '12',
      LIVE_RESEARCH_MAX_SEARCHES: '8',
      LIVE_RESEARCH_MAX_EXTRACTS: '-1',
      LIVE_RESEARCH_MAX_CALLS: '2.5',
      LIVE_RESEARCH_MAX_CREDITS: 'invalid',
    });

    expect(options.llm?.maxCalls).toBe(0);
    expect(options.llm?.maxCredits).toBe(12);
    expect(options.research?.maxSearches).toBe(8);
    expect(options.research?.maxExtracts).toBe(
      DEFAULT_LIVE_RESEARCH_BUDGET.maxExtracts,
    );
    expect(options.research?.maxCalls).toBe(
      DEFAULT_LIVE_RESEARCH_BUDGET.maxCalls,
    );
    expect(options.research?.maxCredits).toBe(
      DEFAULT_LIVE_RESEARCH_BUDGET.maxCredits,
    );
  });
});
