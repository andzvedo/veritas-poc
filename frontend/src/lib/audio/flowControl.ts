/**
 * Flow control for the live audio chunks (LIVE-003).
 *
 * The controller owns two invariants that the rest of the pipeline relies on:
 *
 * 1. **Bounded queue** — at most `maxInFlight` chunks may be awaiting ACK.
 *    `beginChunk()` returns `null` when saturated instead of growing a queue.
 * 2. **No silent loss** — audio that is dropped (saturation, retries exhausted,
 *    unacked at shutdown, paused capture) is exposed as an explicit `GapRange`,
 *    never discarded quietly.
 *
 * The sample clock (`startSample`) only moves forward and never compacts:
 * every sample that belonged to the capture is either sent or reported as a gap.
 *
 * Pure TypeScript (no DOM, no timers): it is unit-tested in Node.
 */

/** Descriptor of one chunk accepted by the controller. */
export interface ChunkDescriptor {
  /** Monotonic chunk id assigned by the controller (idempotent retries reuse it). */
  chunkSeq: number;
  /** First sample of the chunk in the 16 kHz capture timeline. */
  startSample: number;
  /** Number of samples (1600 == 100 ms at 16 kHz). */
  samples: number;
}

/** A range of the capture timeline that will never reach the backend. */
export interface GapRange {
  /** Inclusive first sample. */
  fromSample: number;
  /** Exclusive end sample. */
  toSample: number;
  /** `toSample - fromSample`. */
  samples: number;
  /** Human-readable cause (`saturated`, `retries-exhausted`, `paused`, ...). */
  reason: string;
  /** Chunk ids folded into this range (bounded list, see `maxGapChunkSeqs`). */
  chunkSeqs: number[];
}

/** Aggregated, bounded view of everything the controller knows about loss. */
export interface GapReport {
  /** Retained gap ranges (bounded by `maxGapRanges`). */
  ranges: GapRange[];
  /** Samples reported through retained ranges plus compacted ones. */
  totalSamples: number;
  /** Chunks reported through retained ranges plus compacted ones. */
  totalChunks: number;
  /** Ranges that did not fit in `maxGapRanges` (audio still accounted for). */
  compactedRanges: number;
  /** Samples accounted for by compacted ranges. */
  compactedSamples: number;
  /** `true` when anything was lost. */
  hasGap: boolean;
  /** Chunks currently awaiting ACK (potential, not confirmed, loss). */
  unacked: ChunkDescriptor[];
}

export interface ChunkFlowControllerOptions {
  /** Maximum chunks awaiting ACK. Default: 8. */
  maxInFlight?: number;
  /** Retries allowed per chunk before it is dropped. Default: 3. */
  maxRetries?: number;
  /** Maximum retained gap ranges (keeping the report bounded). Default: 64. */
  maxGapRanges?: number;
  /** Maximum chunk ids kept per gap range. Default: 32. */
  maxGapChunkSeqs?: number;
}

/** Result of `fail()`: retry the same chunk, drop it, or ignore a stale report. */
export interface ChunkFailureResult {
  action: 'retry' | 'dropped' | 'ignored';
  /** The chunk that failed (absent when the report was stale). */
  chunk: ChunkDescriptor | null;
  /** Failures observed for this chunk, including the current one. */
  attempts: number;
  /** Gap created when the chunk was dropped. */
  gap: GapRange | null;
}

const DEFAULT_MAX_IN_FLIGHT = 8;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_GAP_RANGES = 64;
const DEFAULT_MAX_GAP_CHUNK_SEQS = 32;

interface InFlightChunk extends ChunkDescriptor {
  attempts: number;
}

/** Reason used when retries are exhausted. */
export const GAP_REASON_RETRIES_EXHAUSTED = 'retries-exhausted';

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(
      `ChunkFlowController: ${name} deve ser um inteiro positivo (recebido ${String(value)})`,
    );
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `ChunkFlowController: ${name} deve ser um inteiro >= 0 (recebido ${String(value)})`,
    );
  }
}

/**
 * Tracks chunk sequencing, in-flight window and gaps for one capture session.
 */
export class ChunkFlowController {
  readonly maxInFlight: number;
  readonly maxRetries: number;
  readonly maxGapRanges: number;
  readonly maxGapChunkSeqs: number;

  private nextSeq = 0;
  private nextSample = 0;
  private readonly inFlight = new Map<number, InFlightChunk>();
  private readonly gaps: GapRange[] = [];
  private compactedRanges = 0;
  private compactedSamples = 0;
  private compactedChunks = 0;
  private ackedChunks = 0;
  private droppedChunks = 0;

  constructor(options: ChunkFlowControllerOptions = {}) {
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxGapRanges = options.maxGapRanges ?? DEFAULT_MAX_GAP_RANGES;
    this.maxGapChunkSeqs = options.maxGapChunkSeqs ?? DEFAULT_MAX_GAP_CHUNK_SEQS;

    assertPositiveInteger(this.maxInFlight, 'maxInFlight');
    assertNonNegativeInteger(this.maxRetries, 'maxRetries');
    assertPositiveInteger(this.maxGapRanges, 'maxGapRanges');
    assertPositiveInteger(this.maxGapChunkSeqs, 'maxGapChunkSeqs');
  }

  /** Sequence number that the next accepted chunk will receive. */
  get nextChunkSeq(): number {
    return this.nextSeq;
  }

  /** `startSample` that the next accepted chunk will receive. */
  get startSample(): number {
    return this.nextSample;
  }

  /** Chunks currently awaiting ACK. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /** `true` while there is room for another chunk. */
  get hasCapacity(): boolean {
    return this.inFlight.size < this.maxInFlight;
  }

  /** Chunks acknowledged so far. */
  get ackedCount(): number {
    return this.ackedChunks;
  }

  /** Chunks dropped so far (retries exhausted). */
  get droppedCount(): number {
    return this.droppedChunks;
  }

  /**
   * Reserves a slot for a chunk of `samples` samples.
   *
   * Returns `null` when the in-flight window is full. A `null` result means the
   * caller **must** account for the audio itself, either by retrying later or by
   * calling `registerGap('saturated', samples)`; the controller deliberately
   * does not advance the sample clock for rejected chunks.
   */
  beginChunk(samples: number): ChunkDescriptor | null {
    assertPositiveInteger(samples, 'samples');

    if (!this.hasCapacity) {
      return null;
    }

    const chunk: InFlightChunk = {
      chunkSeq: this.nextSeq,
      startSample: this.nextSample,
      samples,
      attempts: 0,
    };

    this.nextSeq += 1;
    this.nextSample += samples;
    this.inFlight.set(chunk.chunkSeq, chunk);

    return this.describe(chunk);
  }

  /**
   * Marks a chunk as accepted by the transport.
   *
   * @returns `true` when the chunk was in flight; `false` for unknown, repeated
   * or already-dropped ids (a late ACK must never resurrect a gap).
   */
  ack(chunkSeq: number): boolean {
    if (!this.inFlight.delete(chunkSeq)) {
      return false;
    }
    this.ackedChunks += 1;
    return true;
  }

  /**
   * Records a failed delivery.
   *
   * - `retry`: the chunk keeps its slot and **the same** `chunkSeq` so the
   *   backend can deduplicate idempotent retries.
   * - `dropped`: retries are exhausted; the samples become an explicit gap.
   * - `ignored`: unknown chunk (late failure after ACK/drop).
   */
  fail(chunkSeq: number): ChunkFailureResult {
    const chunk = this.inFlight.get(chunkSeq);

    if (!chunk) {
      return { action: 'ignored', chunk: null, attempts: 0, gap: null };
    }

    chunk.attempts += 1;

    if (chunk.attempts <= this.maxRetries) {
      return {
        action: 'retry',
        chunk: this.describe(chunk),
        attempts: chunk.attempts,
        gap: null,
      };
    }

    this.inFlight.delete(chunkSeq);
    this.droppedChunks += 1;

    const gap = this.pushGap({
      fromSample: chunk.startSample,
      toSample: chunk.startSample + chunk.samples,
      samples: chunk.samples,
      reason: GAP_REASON_RETRIES_EXHAUSTED,
      chunkSeqs: [chunk.chunkSeq],
    });

    return {
      action: 'dropped',
      chunk: this.describe(chunk),
      attempts: chunk.attempts,
      gap,
    };
  }

  /**
   * Drops an in-flight chunk **without retrying** and records it as a gap.
   *
   * Used when the backend rejected the chunk with a definitive reason (the
   * session is not listening, it ended, the transport rate limit…): resending
   * the same `chunkSeq` would be rejected again and only amplify traffic.
   * Returns `null` for unknown/already settled chunks.
   */
  drop(chunkSeq: number, reason: string): ChunkFailureResult {
    const chunk = this.inFlight.get(chunkSeq);

    if (!chunk) {
      return { action: 'ignored', chunk: null, attempts: 0, gap: null };
    }

    this.inFlight.delete(chunkSeq);
    this.droppedChunks += 1;

    const gap = this.pushGap({
      fromSample: chunk.startSample,
      toSample: chunk.startSample + chunk.samples,
      samples: chunk.samples,
      reason,
      chunkSeqs: [chunk.chunkSeq],
    });

    return {
      action: 'dropped',
      chunk: this.describe(chunk),
      attempts: chunk.attempts + 1,
      gap,
    };
  }

  /**
   * Removes and returns every unacked chunk (sorted by `chunkSeq`).
   *
   * Called when the capture is ending: the caller takes ownership of the
   * descriptors to force a last delivery. If those chunks cannot be delivered,
   * the caller must call `registerGap('unacked')` before `reset()`.
   */
  flushPending(): ChunkDescriptor[] {
    const pending = this.pendingChunks();
    this.inFlight.clear();
    return pending;
  }

  /** Unacked chunks, sorted by `chunkSeq` (does not mutate state). */
  pendingChunks(): ChunkDescriptor[] {
    return [...this.inFlight.values()]
      .sort((left, right) => left.chunkSeq - right.chunkSeq)
      .map((chunk) => this.describe(chunk));
  }

  /**
   * Registers audio that will never be delivered.
   *
   * - With `samples > 0`: audio that was never scheduled (e.g. saturation) is
   *   appended to the capture timeline; the sample clock advances so the next
   *   chunk keeps media continuity.
   * - Without `samples`: every currently unacked chunk is dropped and reported
   *   (contiguous runs become one range each).
   *
   * @returns the ranges created, in timeline order.
   */
  registerGap(reason: string, samples?: number): GapRange[] {
    if (typeof samples === 'number') {
      assertPositiveInteger(samples, 'samples');

      const fromSample = this.nextSample;
      const toSample = fromSample + samples;
      this.nextSample = toSample;

      return [
        this.pushGap({
          fromSample,
          toSample,
          samples,
          reason,
          chunkSeqs: [],
        }),
      ];
    }

    const pending = [...this.inFlight.values()].sort(
      (left, right) => left.startSample - right.startSample,
    );
    this.inFlight.clear();

    if (pending.length === 0) {
      return [];
    }

    // Split non-contiguous chunks into separate ranges so a reported gap never
    // claims that audio delivered in between was also lost.
    const created: GapRange[] = [];
    let run: InFlightChunk[] = [];

    const flushRun = () => {
      if (run.length === 0) {
        return;
      }
      const fromSample = run[0].startSample;
      const last = run[run.length - 1];
      const toSample = last.startSample + last.samples;
      created.push(
        this.pushGap({
          fromSample,
          toSample,
          samples: toSample - fromSample,
          reason,
          chunkSeqs: run.map((chunk) => chunk.chunkSeq),
        }),
      );
      run = [];
    };

    for (const chunk of pending) {
      const previous = run[run.length - 1];
      if (previous && previous.startSample + previous.samples !== chunk.startSample) {
        flushRun();
      }
      run.push(chunk);
    }
    flushRun();

    this.droppedChunks += created.reduce(
      (total, gap) => total + gap.chunkSeqs.length,
      0,
    );

    return created;
  }

  /** Aggregated gap + unacked view (bounded, safe to report periodically). */
  getGap(): GapReport {
    const retainedSamples = this.gaps.reduce((total, gap) => total + gap.samples, 0);
    const retainedChunks = this.gaps.reduce(
      (total, gap) => total + gap.chunkSeqs.length,
      0,
    );
    const totalSamples = retainedSamples + this.compactedSamples;
    const totalChunks = retainedChunks + this.compactedChunks;

    return {
      ranges: this.gaps.map((gap) => ({
        ...gap,
        chunkSeqs: [...gap.chunkSeqs],
      })),
      totalSamples,
      totalChunks,
      compactedRanges: this.compactedRanges,
      compactedSamples: this.compactedSamples,
      hasGap: totalSamples > 0,
      unacked: this.pendingChunks(),
    };
  }

  /**
   * Clears in-flight chunks, gaps, counters and the sample clock.
   *
   * Used when a capture is cancelled (the session is discarded, so unacked
   * audio must not be reported as a gap for a session that no longer exists)
   * and when a controller is recycled for a brand-new capture.
   */
  reset(): void {
    this.nextSeq = 0;
    this.nextSample = 0;
    this.inFlight.clear();
    this.gaps.length = 0;
    this.compactedRanges = 0;
    this.compactedSamples = 0;
    this.compactedChunks = 0;
    this.ackedChunks = 0;
    this.droppedChunks = 0;
  }

  private describe(chunk: InFlightChunk): ChunkDescriptor {
    return {
      chunkSeq: chunk.chunkSeq,
      startSample: chunk.startSample,
      samples: chunk.samples,
    };
  }

  /**
   * Stores a gap range, coalescing contiguous ranges with the same reason so a
   * long saturation event stays a single, readable range instead of thousands.
   * Ranges beyond `maxGapRanges` are counted (not lost) in the report.
   */
  private pushGap(range: GapRange): GapRange {
    const last = this.gaps[this.gaps.length - 1];

    if (last && last.toSample === range.fromSample && last.reason === range.reason) {
      last.toSample = range.toSample;
      last.samples += range.samples;
      const room = this.maxGapChunkSeqs - last.chunkSeqs.length;
      if (room > 0) {
        last.chunkSeqs.push(...range.chunkSeqs.slice(0, room));
      }
      return {
        ...range,
        chunkSeqs: [...range.chunkSeqs],
      };
    }

    if (this.gaps.length >= this.maxGapRanges) {
      this.compactedRanges += 1;
      this.compactedSamples += range.samples;
      this.compactedChunks += range.chunkSeqs.length;
      return {
        ...range,
        chunkSeqs: [...range.chunkSeqs],
      };
    }

    this.gaps.push({
      ...range,
      chunkSeqs: range.chunkSeqs.slice(0, this.maxGapChunkSeqs),
    });

    return {
      ...range,
      chunkSeqs: [...range.chunkSeqs],
    };
  }
}
