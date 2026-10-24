/**
 * Small in-memory token bucket used to limit Socket.IO events per connection
 * (LIVE-038). No external dependency; one instance per socket and event class.
 */
export type TokenBucketOptions = {
  /** Maximum burst. */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
  now?: () => number;
};

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private tokens: number;
  private updatedAt: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = Math.max(1, options.capacity);
    this.refillPerMs = Math.max(0, options.refillPerSecond) / 1000;
    this.now = options.now ?? (() => Date.now());
    this.tokens = this.capacity;
    this.updatedAt = this.now();
  }

  /** Consumes `cost` tokens; returns false (and consumes nothing) if short. */
  tryTake(cost = 1): boolean {
    const now = this.now();
    const elapsed = Math.max(0, now - this.updatedAt);
    this.updatedAt = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    if (this.tokens < cost) {
      return false;
    }
    this.tokens -= cost;
    return true;
  }
}

export type LiveRateLimits = {
  /** AUDIO_CHUNK events. Default: burst 64, 32/s (≈ 16 chunks of 500 ms/s). */
  audio: TokenBucketOptions;
  /** Control / correction / review / export events. Default: burst 20, 5/s. */
  control: TokenBucketOptions;
  /** START_LIVE_SESSION / RESUME_SESSION. Default: burst 5, 1 every 6 s. */
  session: TokenBucketOptions;
};

export const DEFAULT_LIVE_RATE_LIMITS: LiveRateLimits = {
  audio: { capacity: 64, refillPerSecond: 32 },
  control: { capacity: 20, refillPerSecond: 5 },
  session: { capacity: 5, refillPerSecond: 1 / 6 },
};
