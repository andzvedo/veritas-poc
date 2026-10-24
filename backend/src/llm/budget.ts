import { LlmError } from './errors.js';

/**
 * Session-scoped LLM usage limits. Exhaustion surfaces as an explicit QUOTA
 * error so callers can emit DEFERRED — never a silent skip or auto-billing.
 */
export type LlmBudgetOptions = {
  /** Hard cap on model invocations (including repair retries). */
  maxCalls?: number;
  /** Soft estimate of credits remaining; decremented per call. */
  maxCredits?: number;
  /** Credits charged per successful or attempted invoke. Default 1. */
  creditsPerCall?: number;
};

export type LlmUsageSnapshot = {
  calls: number;
  retries: number;
  estimatedCredits: number;
  maxCalls: number | undefined;
  maxCredits: number | undefined;
  remainingCalls: number | undefined;
  remainingCredits: number | undefined;
  exhausted: boolean;
  deferredReason: string | undefined;
};

export class LlmUsageBudget {
  private calls = 0;
  private retries = 0;
  private estimatedCredits = 0;
  private exhaustedReason: string | undefined;
  private readonly maxCalls: number | undefined;
  private readonly maxCredits: number | undefined;
  private readonly creditsPerCall: number;

  constructor(options: LlmBudgetOptions = {}) {
    this.maxCalls = options.maxCalls;
    this.maxCredits = options.maxCredits;
    this.creditsPerCall = options.creditsPerCall ?? 1;
  }

  snapshot(): LlmUsageSnapshot {
    const remainingCalls =
      this.maxCalls === undefined
        ? undefined
        : Math.max(this.maxCalls - this.calls, 0);
    const remainingCredits =
      this.maxCredits === undefined
        ? undefined
        : Math.max(this.maxCredits - this.estimatedCredits, 0);

    return {
      calls: this.calls,
      retries: this.retries,
      estimatedCredits: this.estimatedCredits,
      maxCalls: this.maxCalls,
      maxCredits: this.maxCredits,
      remainingCalls,
      remainingCredits,
      exhausted: this.exhaustedReason !== undefined,
      deferredReason: this.exhaustedReason,
    };
  }

  /**
   * Reserves one call before invoking the model. Throws {@link LlmError}
   * with kind QUOTA when the budget is already exhausted.
   */
  consume(isRetry = false): void {
    if (this.exhaustedReason !== undefined) {
      throw new LlmError('QUOTA', this.exhaustedReason);
    }

    const nextCalls = this.calls + 1;
    const nextCredits = this.estimatedCredits + this.creditsPerCall;

    if (this.maxCalls !== undefined && nextCalls > this.maxCalls) {
      this.exhaustedReason = `Orçamento de LLM esgotado: limite de ${String(this.maxCalls)} chamada(s) atingido.`;
      throw new LlmError('QUOTA', this.exhaustedReason);
    }
    if (this.maxCredits !== undefined && nextCredits > this.maxCredits) {
      this.exhaustedReason = `Orçamento de LLM esgotado: limite de ${String(this.maxCredits)} crédito(s) atingido.`;
      throw new LlmError('QUOTA', this.exhaustedReason);
    }

    this.calls = nextCalls;
    this.estimatedCredits = nextCredits;
    if (isRetry) {
      this.retries += 1;
    }
  }
}
