/**
 * Bounded, transport-agnostic async investigation queue.
 *
 * The queue owns scheduling only: it never imports an LLM or a transport.
 * Callers receive their own occurrence result even when the work was cached,
 * and a failure in one investigation never stops the others.
 */

export type ClaimQueueJob<T> = {
  /** Claim id of this occurrence. */
  id: string;
  /** Optional cache key (see `buildClaimKey`). Work is only cached when set. */
  key?: string;
  /** Cache version; a different version forces a new investigation. Defaults to `'0'`. */
  version?: string | number;
  /** Higher priority runs first. Defaults to 0. */
  priority?: number;
  run: (signal: AbortSignal) => Promise<T>;
};

export type ClaimQueueMetrics = {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  deferred: number;
  cancelled: number;
  cacheHits: number;
};

export type ClaimQueueEvent =
  | { type: 'STARTED'; id: string; key?: string; attempt: number }
  | { type: 'COMPLETED'; id: string; key?: string; attempts: number }
  | { type: 'FAILED'; id: string; attempt: number; error: unknown }
  | { type: 'RETRYING'; id: string; attempt: number; delayMs: number }
  | { type: 'DEFERRED'; id: string; reason: string }
  | { type: 'CANCELLED'; id: string; reason: string }
  | { type: 'CACHE_HIT'; id: string; key: string };

export type ClaimQueueOptions = {
  /** Maximum investigations running at the same time. Defaults to 2. */
  concurrency?: number;
  /** Maximum investigations waiting for a slot. Defaults to 10. */
  capacity?: number;
  /** Per-attempt timeout in ms. Defaults to 90000. `0` disables the timeout. */
  timeoutMs?: number;
  /** Retries after the first failure. Defaults to 1. */
  maxRetries?: number;
  /** Delay before a retry in ms. Defaults to 500. */
  retryDelayMs?: number;
  /** Completed results kept for reuse. Defaults to 100. `0` disables caching. */
  cacheLimit?: number;
  /** Predicate deciding whether an error is transient. */
  isRetryable?: (error: unknown, attempt: number) => boolean;
  /** Observer for status events (wire it to the transport outside this module). */
  onEvent?: (event: ClaimQueueEvent) => void;
};

export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_CAPACITY = 10;
export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_MAX_RETRIES = 1;
export const DEFAULT_RETRY_DELAY_MS = 500;
export const DEFAULT_CACHE_LIMIT = 100;

export class QueueTimeoutError extends Error {
  readonly claimId: string;
  readonly timeoutMs: number;

  constructor(claimId: string, timeoutMs: number) {
    super(
      `A verificação da claim "${claimId}" excedeu o tempo limite de ${timeoutMs.toString()}ms.`,
    );
    this.name = 'QueueTimeoutError';
    this.claimId = claimId;
    this.timeoutMs = timeoutMs;
  }
}

export class QueueCancelledError extends Error {
  readonly reason: string;
  readonly claimId: string | undefined;

  constructor(reason: string, claimId?: string) {
    super(
      claimId === undefined
        ? `Fila de verificações cancelada: ${reason}`
        : `A verificação da claim "${claimId}" foi cancelada: ${reason}`,
    );
    this.name = 'QueueCancelledError';
    this.reason = reason;
    this.claimId = claimId;
  }
}

export class QueueDeferredError extends Error {
  readonly claimId: string;
  readonly capacity: number;

  constructor(claimId: string, capacity: number) {
    super(
      `A verificação da claim "${claimId}" foi adiada (DEFERRED): a fila já tem ${capacity.toString()} trabalho(s) aguardando.`,
    );
    this.name = 'QueueDeferredError';
    this.claimId = claimId;
    this.capacity = capacity;
  }
}

type QueueJob<T> = {
  id: string;
  key: string | undefined;
  version: string;
  priority: number;
  seq: number;
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  attempts: number;
};

type ActiveRun<T> = {
  job: QueueJob<T>;
  controller: AbortController | undefined;
  interrupt: ((error: QueueCancelledError) => void) | undefined;
  cancelled: boolean;
  reason: string;
};

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof QueueTimeoutError || error instanceof QueueCancelledError) {
    return false;
  }
  return !isAbortError(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export class ClaimQueue<T> {
  private readonly concurrency: number;
  private readonly capacity: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly cacheLimit: number;
  private readonly isRetryable: (error: unknown, attempt: number) => boolean;
  private readonly onEvent: ((event: ClaimQueueEvent) => void) | undefined;

  private readonly pending: QueueJob<T>[] = [];
  private readonly active = new Set<ActiveRun<T>>();
  private readonly cache = new Map<string, { version: string; value: T }>();
  private readonly counters = {
    completed: 0,
    failed: 0,
    deferred: 0,
    cancelled: 0,
    cacheHits: 0,
  };
  private idleWaiters: Array<() => void> = [];
  private seq = 0;

  constructor(options: ClaimQueueOptions = {}) {
    this.concurrency = Math.max(
      1,
      positiveInteger(options.concurrency, DEFAULT_CONCURRENCY),
    );
    this.capacity = positiveInteger(options.capacity, DEFAULT_CAPACITY);
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxRetries = positiveInteger(options.maxRetries, DEFAULT_MAX_RETRIES);
    this.retryDelayMs = positiveInteger(
      options.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS,
    );
    this.cacheLimit = positiveInteger(options.cacheLimit, DEFAULT_CACHE_LIMIT);
    this.isRetryable = options.isRetryable ?? defaultIsRetryable;
    this.onEvent = options.onEvent;
  }

  /**
   * Accepts one occurrence. Resolves with the investigation result (fresh or
   * cached) and rejects with `QueueDeferredError`, `QueueTimeoutError`,
   * `QueueCancelledError` or the task's own error.
   */
  enqueue(job: ClaimQueueJob<T>): Promise<T> {
    if (job.id.length === 0) {
      throw new TypeError('ClaimQueue.enqueue requires a non-empty claim id.');
    }

    const version = job.version === undefined ? '0' : String(job.version);

    if (job.key !== undefined && this.cacheLimit > 0) {
      const entry = this.cache.get(job.key);
      if (entry !== undefined && entry.version === version) {
        this.counters.cacheHits += 1;
        this.emit({ type: 'CACHE_HIT', id: job.id, key: job.key });
        return Promise.resolve(entry.value);
      }
    }

    if (this.pending.length >= this.capacity) {
      this.counters.deferred += 1;
      const error = new QueueDeferredError(job.id, this.capacity);
      this.emit({ type: 'DEFERRED', id: job.id, reason: error.message });
      return Promise.reject(error);
    }

    return new Promise<T>((resolve, reject) => {
      const queued: QueueJob<T> = {
        id: job.id,
        key: job.key,
        version,
        priority: job.priority ?? 0,
        seq: this.seq++,
        run: job.run,
        resolve,
        reject,
        attempts: 0,
      };
      this.pending.push(queued);
      this.pump();
    });
  }

  /**
   * Cancels waiting work and the active runs (aborting their signals). Late
   * results of the aborted runs are discarded.
   */
  cancelAll(reason = 'sessão encerrada'): void {
    for (const job of this.pending.splice(0)) {
      const error = new QueueCancelledError(reason, job.id);
      this.counters.cancelled += 1;
      this.emit({ type: 'CANCELLED', id: job.id, reason });
      job.reject(error);
    }

    for (const run of this.active) {
      run.cancelled = true;
      run.reason = reason;
      const error = new QueueCancelledError(reason, run.job.id);
      run.controller?.abort(error);
      run.interrupt?.(error);
    }

    this.checkIdle();
  }

  /**
   * Cancels one occurrence (waiting or running) by job id, aborting its
   * signal. Returns true when something was cancelled. Used when an input
   * revision changes and the in-flight investigation became stale (LIVE-040).
   */
  cancel(id: string, reason = 'cancelada'): boolean {
    let cancelled = false;
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const job = this.pending[index];
      if (job.id !== id) {
        continue;
      }
      this.pending.splice(index, 1);
      this.counters.cancelled += 1;
      this.emit({ type: 'CANCELLED', id: job.id, reason });
      job.reject(new QueueCancelledError(reason, job.id));
      cancelled = true;
    }
    for (const run of this.active) {
      if (run.job.id !== id || run.cancelled) {
        continue;
      }
      run.cancelled = true;
      run.reason = reason;
      const error = new QueueCancelledError(reason, run.job.id);
      run.controller?.abort(error);
      run.interrupt?.(error);
      cancelled = true;
    }
    this.checkIdle();
    return cancelled;
  }

  getMetrics(): ClaimQueueMetrics {
    return {
      queued: this.pending.length,
      active: this.active.size,
      completed: this.counters.completed,
      failed: this.counters.failed,
      deferred: this.counters.deferred,
      cancelled: this.counters.cancelled,
      cacheHits: this.counters.cacheHits,
    };
  }

  /** Resolves when no work is queued or running (normal session shutdown). */
  async drain(): Promise<void> {
    if (this.isIdle()) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** Drops cached results, optionally only one key. */
  clearCache(key?: string): void {
    if (key === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(key);
  }

  private isIdle(): boolean {
    return this.pending.length === 0 && this.active.size === 0;
  }

  private checkIdle(): void {
    if (!this.isIdle()) {
      return;
    }
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  private emit(event: ClaimQueueEvent): void {
    if (this.onEvent === undefined) {
      return;
    }
    try {
      this.onEvent(event);
    } catch {
      // Observers must never break scheduling.
    }
  }

  private pump(): void {
    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const job = this.dequeue();
      if (job === undefined) {
        break;
      }
      void this.runJob(job);
    }
    this.checkIdle();
  }

  private dequeue(): QueueJob<T> | undefined {
    if (this.pending.length === 0) {
      return undefined;
    }
    let bestIndex = 0;
    for (let index = 1; index < this.pending.length; index++) {
      const candidate = this.pending[index];
      const best = this.pending[bestIndex];
      if (
        candidate.priority > best.priority ||
        (candidate.priority === best.priority && candidate.seq < best.seq)
      ) {
        bestIndex = index;
      }
    }
    return this.pending.splice(bestIndex, 1).at(0);
  }

  private async runJob(job: QueueJob<T>): Promise<void> {
    const run: ActiveRun<T> = {
      job,
      controller: undefined,
      interrupt: undefined,
      cancelled: false,
      reason: 'cancelada',
    };
    this.active.add(run);

    try {
      for (;;) {
        if (run.cancelled) {
          this.rejectCancelled(run);
          return;
        }

        job.attempts += 1;
        this.emit({ type: 'STARTED', id: job.id, key: job.key, attempt: job.attempts });

        try {
          const value = await this.runAttempt(run);
          this.counters.completed += 1;
          this.remember(job, value);
          this.emit({
            type: 'COMPLETED',
            id: job.id,
            key: job.key,
            attempts: job.attempts,
          });
          job.resolve(value);
          return;
        } catch (error) {
          if (error instanceof QueueCancelledError) {
            this.rejectCancelled(run);
            return;
          }

          const canRetry =
            job.attempts <= this.maxRetries && this.isRetryable(error, job.attempts);
          if (!canRetry) {
            this.counters.failed += 1;
            this.emit({
              type: 'FAILED',
              id: job.id,
              attempt: job.attempts,
              error,
            });
            job.reject(error);
            return;
          }

          this.emit({
            type: 'RETRYING',
            id: job.id,
            attempt: job.attempts,
            delayMs: this.retryDelayMs,
          });
          try {
            await this.waitRetryDelay(run);
          } catch (cancelError) {
            if (cancelError instanceof QueueCancelledError) {
              this.rejectCancelled(run);
            } else {
              this.counters.failed += 1;
              this.emit({
                type: 'FAILED',
                id: job.id,
                attempt: job.attempts,
                error: cancelError,
              });
              job.reject(cancelError);
            }
            return;
          }
        }
      }
    } finally {
      this.active.delete(run);
      this.pump();
    }
  }

  private rejectCancelled(run: ActiveRun<T>): void {
    this.counters.cancelled += 1;
    this.emit({ type: 'CANCELLED', id: run.job.id, reason: run.reason });
    run.job.reject(new QueueCancelledError(run.reason, run.job.id));
  }

  /** One attempt: runs the task, races it against timeout and cancellation. */
  private runAttempt(run: ActiveRun<T>): Promise<T> {
    const { job } = run;
    return new Promise<T>((resolve, reject) => {
      const jobId = job.id;
      const controller = new AbortController();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        run.controller = undefined;
        run.interrupt = undefined;
      };

      run.controller = controller;
      run.interrupt = (error) => {
        if (settled) {
          return;
        }
        cleanup();
        reject(error);
      };

      if (this.timeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) {
            return;
          }
          const error = new QueueTimeoutError(jobId, this.timeoutMs);
          controller.abort(error);
          cleanup();
          reject(error);
        }, this.timeoutMs);
      }

      let execution: Promise<T>;
      try {
        execution = job.run(controller.signal);
      } catch (error) {
        cleanup();
        reject(asError(error));
        return;
      }

      void execution.then(
        (value) => {
          if (settled) {
            return;
          }
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          cleanup();
          reject(asError(error));
        },
      );
    });
  }

  /** Cancellable retry delay; keeps the queue slot while waiting. */
  private waitRetryDelay(run: ActiveRun<T>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        settled = true;
        clearTimeout(timer);
        run.interrupt = undefined;
      };

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        cleanup();
        resolve();
      }, this.retryDelayMs);

      run.interrupt = (error) => {
        if (settled) {
          return;
        }
        cleanup();
        reject(error);
      };
    });
  }

  private remember(job: QueueJob<T>, value: T): void {
    if (job.key === undefined || this.cacheLimit <= 0) {
      return;
    }
    this.cache.delete(job.key);
    this.cache.set(job.key, { version: job.version, value });
    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.cache.delete(oldest.value);
    }
  }
}
