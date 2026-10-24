/**
 * Failure taxonomy of the LLM layer. Callers map QUOTA to DEFERRED and never
 * to a factual verdict (LIVE-018).
 */
export type LlmErrorKind =
  | 'TRANSIENT'
  | 'QUOTA'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'INVALID';

export type LlmErrorOptions = {
  status?: number;
  cause?: unknown;
};

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: LlmErrorKind,
    message: string,
    options: LlmErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'LlmError';
    this.kind = kind;
    this.status = options.status;
  }
}
