/**
 * Transcript consolidation for the live pipeline (LIVE-005 / LIVE-009).
 *
 * Responsibilities:
 * - merge overlapping ASR windows without repeating or silently dropping text;
 * - keep stable segment ids/revisions while a hypothesis is provisional;
 * - split long accumulations on sentence punctuation when a window closes;
 * - block segments whose critical words (numbers/negations) are uncertain;
 * - provide an explicit, revision-checked correction path that keeps history.
 *
 * Design rules:
 * - Text is only ever appended at *word* boundaries, so a negation, unit or
 *   number can never be cut in half at a window border.
 * - Nothing is dropped silently: empty/overlap/structural problems become
 *   `uncertaintyReasons` and, once finalized, a `BLOCKED` status.
 * - A human correction is the only way to clear text-derived uncertainty; it
 *   never rewrites the historical revisions (see `getHistory`).
 */
import type {
  TranscriptSegment,
  TranscriptSegmentStatus,
  UncertaintyReason,
} from '@veritas/shared';

/** Below this, a hypothesis is considered doubtful (LIVE-005). */
export const LOW_CONFIDENCE_THRESHOLD = 0.55;
/** Default gap (ms) that closes a segment and starts a new one. */
export const DEFAULT_SEGMENT_GAP_MS = 1500;
/** Accumulated text shorter than this is not finalized on a gap. */
export const DEFAULT_MIN_FINAL_CHARS = 40;
/** Accumulated text longer than this is split on a sentence boundary. */
export const DEFAULT_MAX_SEGMENT_CHARS = 320;
/** Word-level overlap reconciliation never trims more than this. */
export const DEFAULT_MAX_OVERLAP_WORDS = 12;
/** Silence threshold for normalized PCM16 RMS (0..1). */
export const DEFAULT_SILENCE_THRESHOLD = 0.008;

/** One ASR hypothesis, with timestamps in media time. */
export type SpeechWindow = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

export type SpeechWindowOptions = {
  speakerId?: string;
  /**
   * Structural uncertainty the caller already knows about (e.g. overlapping
   * audio, transcription failure). Merged into the segment reasons.
   */
  reasons?: readonly UncertaintyReason[];
};

export type SpeechSegmenterOptions = {
  sessionId: string;
  clock?: () => Date;
  /** Silence between windows that closes the current segment. */
  gapMs?: number;
  minFinalChars?: number;
  maxSegmentChars?: number;
  lowConfidenceThreshold?: number;
  /**
   * When the ASR gives no confidence at all, critical words (numbers,
   * negations) are still treated as doubtful. Conservative default: true
   * (PRD §6 regra 11 / especificação §9 etapa 0).
   */
  blockOnCriticalTokensWithoutConfidence?: boolean;
};

export type SpeechWindowResult = {
  /** The segment that is still open after this window (if any). */
  current?: TranscriptSegment;
  /** Segments closed by this window (gap, speaker change or length split). */
  finalized: TranscriptSegment[];
  overlapWordsTrimmed: number;
  /** Segmenter change cursor after this window. */
  cursor: number;
};

export type SegmentDependency =
  | { kind: 'window'; windowId: string }
  | { kind: 'revision'; segmentId: string; revision: number };

export type SegmentHistoryEntry = {
  segmentId: string;
  revision: number;
  text: string;
  status: TranscriptSegmentStatus;
  confidence?: number;
  uncertaintyReasons: UncertaintyReason[];
  createdAt: string;
  dependencies: SegmentDependency[];
};

export class SpeechSegmenterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechSegmenterError';
  }
}

export class SegmentNotFoundError extends SpeechSegmenterError {
  readonly segmentId: string;

  constructor(segmentId: string) {
    super(`Segmento "${segmentId}" não existe nesta sessão`);
    this.name = 'SegmentNotFoundError';
    this.segmentId = segmentId;
  }
}

export class SegmentRevisionConflictError extends SpeechSegmenterError {
  readonly segmentId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(
    segmentId: string,
    expectedRevision: number,
    actualRevision: number,
  ) {
    super(
      `Revisão do segmento "${segmentId}" mudou (esperada ${String(expectedRevision)}, atual ${String(actualRevision)})`,
    );
    this.name = 'SegmentRevisionConflictError';
    this.segmentId = segmentId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class SegmentCorrectionError extends SpeechSegmenterError {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentCorrectionError';
  }
}

// ===== Pure helpers =====
const NUMBER_PATTERN = /\d/;
const NEGATION_PATTERN =
  /\b(n[ãa]o|nunca|jamais|sem|nenhum|nenhuma|nenhuns|nenhumas|tampouco|sequer)\b/iu;
const SENTENCE_END_PATTERN = /[.!?…](?=\s|$)/gu;

/**
 * Detects the uncertainty signals the transcript layer is responsible for.
 *
 * `SUBJECT` is intentionally not inferred from text: deciding whether the
 * subject of a sentence is doubtful is a semantic judgement owned by the
 * context/claim layer, which can pass it as a structural reason.
 */
export function detectUncertainty(
  text: string,
  confidence?: number,
): UncertaintyReason[] {
  const reasons: UncertaintyReason[] = [];
  if (NUMBER_PATTERN.test(text)) {
    reasons.push('NUMBER');
  }
  if (NEGATION_PATTERN.test(text)) {
    reasons.push('NEGATION');
  }
  if (confidence !== undefined && confidence < LOW_CONFIDENCE_THRESHOLD) {
    reasons.push('LOW_CONFIDENCE');
  }
  return reasons;
}

/** Collapses whitespace and trims; never removes words. */
export function normalizeSpeechText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

type Token = {
  normalized: string;
  start: number;
  end: number;
};

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Words that must never be dropped on the strength of a one-word "overlap":
 * negations (meaning-critical) and very common short tokens (noise).
 */
const AMBIGUOUS_SINGLE_WORD_OVERLAP: ReadonlySet<string> = new Set([
  'nao',
  'não',
  'nunca',
  'jamais',
  'sem',
  'nenhum',
  'nenhuma',
  'nem',
  'tampouco',
  'sequer',
  'e',
  'é',
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'em',
  'no',
  'na',
  'um',
  'uma',
  'que',
]);

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  const pattern = /\S+/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({
      normalized: match[0].replace(EDGE_PUNCTUATION, '').toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
};

/**
 * Merges an incoming window into the text already accumulated.
 *
 * Only a suffix of the previous text that is *inside its last sentence* can be
 * a real overlap: if a sentence terminator precedes the candidate suffix, the
 * repeated words start a new sentence and must be kept (so a negation like
 * "… não. Não é verdade." is never collapsed).
 */
export function reconcileOverlap(
  previousText: string,
  incomingText: string,
  maxWords = DEFAULT_MAX_OVERLAP_WORDS,
): { text: string; trimmedWords: number } {
  const previous = normalizeSpeechText(previousText);
  const incoming = normalizeSpeechText(incomingText);
  if (previous.length === 0) {
    return { text: incoming, trimmedWords: 0 };
  }
  if (incoming.length === 0) {
    return { text: previous, trimmedWords: 0 };
  }

  const previousTokens = tokenize(previous);
  const incomingTokens = tokenize(incoming);
  const limit = Math.min(
    previousTokens.length,
    incomingTokens.length,
    Math.max(1, maxWords),
  );

  // A terminator only limits the overlap when another sentence follows it:
  // trailing punctuation (every whisper window ends with one) is not a barrier.
  let lastSentenceBreakEnd = 0;
  for (const match of previous.matchAll(SENTENCE_END_PATTERN)) {
    if (previous.slice(match.index + 1).trim().length > 0) {
      lastSentenceBreakEnd = match.index + 1;
    }
  }

  for (let overlap = limit; overlap > 0; overlap--) {
    const suffixStart = previousTokens.length - overlap;
    const firstSuffixToken = previousTokens.at(suffixStart);
    if (
      overlap === 1 &&
      firstSuffixToken !== undefined &&
      AMBIGUOUS_SINGLE_WORD_OVERLAP.has(firstSuffixToken.normalized)
    ) {
      // A single shared short/negation token is not evidence of a re-decode.
      continue;
    }
    if (
      firstSuffixToken !== undefined &&
      firstSuffixToken.start < lastSentenceBreakEnd
    ) {
      // The candidate overlap would swallow a sentence boundary.
      continue;
    }
    let matches = true;
    for (let index = 0; index < overlap; index++) {
      const left = previousTokens.at(previousTokens.length - overlap + index);
      const right = incomingTokens.at(index);
      if (left === undefined || right === undefined) {
        matches = false;
        break;
      }
      if (left.normalized !== right.normalized) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    const lastIncomingToken = incomingTokens.at(overlap - 1);
    const remainder =
      lastIncomingToken === undefined
        ? incoming
        : incoming.slice(lastIncomingToken.end).trim();
    return {
      text:
        remainder.length === 0 ? previous : `${previous} ${remainder}`.trim(),
      trimmedWords: overlap,
    };
  }

  return {
    text: `${previous} ${incoming}`.trim(),
    trimmedWords: 0,
  };
}

/**
 * Splits at the last sentence terminator that fits in `maxChars`. Returns
 * `undefined` when there is no safe boundary (never cuts mid-sentence).
 */
export function splitAtSentenceBoundary(
  text: string,
  maxChars: number,
): { prefix: string; remainder: string } | undefined {
  let lastEnd = -1;
  for (const match of text.matchAll(SENTENCE_END_PATTERN)) {
    if (match.index + 1 > maxChars) {
      break;
    }
    lastEnd = match.index + 1;
  }
  if (lastEnd <= 0) {
    return undefined;
  }
  const prefix = text.slice(0, lastEnd).trim();
  const remainder = text.slice(lastEnd).trim();
  if (prefix.length === 0 || remainder.length === 0) {
    return undefined;
  }
  return { prefix, remainder };
}

/** Normalized PCM16LE RMS in 0..1. */
export function rmsLevel(pcm: Buffer): number {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) {
    return 0;
  }
  let sumOfSquares = 0;
  for (let index = 0; index < samples; index++) {
    const normalized = pcm.readInt16LE(index * 2) / 32768;
    sumOfSquares += normalized * normalized;
  }
  return Math.sqrt(sumOfSquares / samples);
}

/** True when the window carries no usable speech energy (VAD surrogate). */
export function isSilence(
  pcm: Buffer,
  threshold = DEFAULT_SILENCE_THRESHOLD,
): boolean {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new RangeError('threshold must be a non-negative finite number');
  }
  return rmsLevel(pcm) < threshold;
}

// ===== Segmenter =====
type SegmentRecord = {
  segment: TranscriptSegment;
  seq: number;
  windowIds: string[];
  structuralReasons: UncertaintyReason[];
  history: SegmentHistoryEntry[];
  dependencies: SegmentDependency[];
  /** Set once a human correction confirmed the current text. */
  confirmedByHuman: boolean;
};

const uniqueReasons = (
  reasons: readonly UncertaintyReason[],
): UncertaintyReason[] => [...new Set(reasons)];

const clampConfidence = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
};

const combineConfidence = (
  current: number | undefined,
  incoming: number | undefined,
): number | undefined => {
  const left = clampConfidence(current);
  const right = clampConfidence(incoming);
  if (right === undefined) {
    // The appended words have unknown confidence: the merged hypothesis is no
    // longer strictly better than unknown.
    return undefined;
  }
  if (left === undefined) {
    return right;
  }
  return Math.min(left, right);
};

const isOpenStatus = (status: TranscriptSegmentStatus): boolean =>
  status === 'PROVISIONAL';

/**
 * Consolidates successive ASR windows into versioned transcript segments.
 */
export class SpeechSegmenter {
  readonly sessionId: string;

  private readonly clock: () => Date;
  private readonly gapMs: number;
  private readonly minFinalChars: number;
  private readonly maxSegmentChars: number;
  private readonly lowConfidenceThreshold: number;
  private readonly blockOnCriticalTokensWithoutConfidence: boolean;

  private readonly records = new Map<string, SegmentRecord>();
  private openSegmentId: string | undefined;
  private nextSegmentNumber = 1;
  private nextWindowNumber = 1;
  private seq = 0;

  constructor(options: SpeechSegmenterOptions) {
    const sessionId = options.sessionId.trim();
    if (sessionId.length === 0) {
      throw new SpeechSegmenterError('sessionId is required');
    }
    this.sessionId = sessionId;
    this.clock = options.clock ?? (() => new Date());
    this.gapMs = options.gapMs ?? DEFAULT_SEGMENT_GAP_MS;
    this.minFinalChars = options.minFinalChars ?? DEFAULT_MIN_FINAL_CHARS;
    this.maxSegmentChars = options.maxSegmentChars ?? DEFAULT_MAX_SEGMENT_CHARS;
    this.lowConfidenceThreshold =
      options.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
    this.blockOnCriticalTokensWithoutConfidence =
      options.blockOnCriticalTokensWithoutConfidence ?? true;

    if (this.gapMs < 0) {
      throw new SpeechSegmenterError('gapMs must be >= 0');
    }
    if (this.minFinalChars < 0 || this.maxSegmentChars < 1) {
      throw new SpeechSegmenterError('invalid segment length limits');
    }
  }

  /**
   * Merges one ASR window. Always keeps every word: repeated overlap is
   * trimmed only when it is a genuine re-decode of the same sentence tail.
   */
  pushWindow(
    window: SpeechWindow,
    options: SpeechWindowOptions = {},
  ): SpeechWindowResult {
    const text = normalizeSpeechText(window.text);
    const startMs = Math.max(0, Math.round(window.startMs));
    const endMs = Math.max(startMs, Math.round(window.endMs));
    const structural = uniqueReasons(options.reasons ?? []);
    const finalized: TranscriptSegment[] = [];
    let overlapWordsTrimmed = 0;

    let record =
      this.openSegmentId === undefined
        ? undefined
        : this.records.get(this.openSegmentId);

    // A speaker change detected by diarization closes the current segment.
    if (
      record !== undefined &&
      options.speakerId !== undefined &&
      record.segment.speakerId !== undefined &&
      record.segment.speakerId !== options.speakerId
    ) {
      const closed = this.close(record);
      if (closed !== undefined) {
        finalized.push(closed);
      }
      record = undefined;
    }

    // A long silence closes the current segment (never a tiny fragment).
    if (
      record !== undefined &&
      startMs - record.segment.endMs >= this.gapMs &&
      record.segment.text.length >= this.minFinalChars
    ) {
      const closed = this.close(record);
      if (closed !== undefined) {
        finalized.push(closed);
      }
      record = undefined;
    }

    if (record === undefined) {
      if (text.length === 0) {
        // Nothing to keep and no open segment to flag: report state only.
        return {
          finalized,
          overlapWordsTrimmed,
          cursor: this.getCursor(),
        };
      }
      record = this.create({
        text,
        startMs,
        endMs,
        confidence: window.confidence,
        speakerId: options.speakerId,
        structural,
      });
    } else {
      if (text.length === 0) {
        // An empty hypothesis on top of open audio means words were lost.
        structural.push('TRANSCRIPTION_ERROR');
      }
      // Only windows that actually overlap in the media clock can be a
      // re-decode of the same audio. Without overlap the repeated words are
      // new speech and must be kept (e.g. two consecutive negations).
      const audioOverlap = startMs < record.segment.endMs;
      const reconciled =
        text.length === 0 || !audioOverlap
          ? {
              text:
                text.length === 0
                  ? record.segment.text
                  : `${record.segment.text} ${text}`.trim(),
              trimmedWords: 0,
            }
          : reconcileOverlap(record.segment.text, text);
      overlapWordsTrimmed = reconciled.trimmedWords;
      const mergedText = reconciled.text;
      const addedWords = mergedText !== record.segment.text;
      const speakerId = options.speakerId ?? record.segment.speakerId;
      record.structuralReasons = uniqueReasons([
        ...record.structuralReasons,
        ...structural,
      ]);
      const windowId = this.nextWindowId();
      record.windowIds.push(windowId);
      record.dependencies = [
        ...record.dependencies,
        { kind: 'window', windowId },
      ];
      if (addedWords) {
        // A correction only vouches for the text it confirmed; new words must
        // earn certainty again.
        record.confirmedByHuman = false;
      }
      record.segment = {
        ...record.segment,
        text: mergedText,
        endMs: Math.max(record.segment.endMs, endMs),
        confidence: combineConfidence(
          record.segment.confidence,
          window.confidence,
        ),
        revision: record.segment.revision + (addedWords ? 1 : 0),
        ...(speakerId === undefined ? {} : { speakerId }),
      };
      this.touch(record);
      record.segment = this.applyProvisionalState(record);
    }

    // Long accumulation: split on the last sentence boundary inside the limit.
    if (record.segment.text.length > this.maxSegmentChars) {
      const split = splitAtSentenceBoundary(
        record.segment.text,
        this.maxSegmentChars,
      );
      if (split !== undefined) {
        const originalEndMs = record.segment.endMs;
        const totalChars = record.segment.text.length;
        const prefixEndMs = Math.min(
          originalEndMs,
          Math.max(
            record.segment.startMs,
            Math.round(
              record.segment.startMs +
                ((originalEndMs - record.segment.startMs) *
                  split.prefix.length) /
                  totalChars,
            ),
          ),
        );
        record.segment = {
          ...record.segment,
          text: split.prefix,
          endMs: prefixEndMs,
          revision: record.segment.revision + 1,
        };
        this.touch(record);
        const closed = this.close(record);
        if (closed !== undefined) {
          finalized.push(closed);
        }
        record = this.create({
          text: split.remainder,
          startMs: prefixEndMs,
          endMs: originalEndMs,
          confidence: record.segment.confidence,
          speakerId: record.segment.speakerId,
          structural: record.structuralReasons,
        });
      }
    }

    return {
      current: this.copy(record.segment),
      finalized: finalized.map((segment) => this.copy(segment)),
      overlapWordsTrimmed,
      cursor: this.getCursor(),
    };
  }

  /** Closes the open segment (if any) and returns it. */
  finalize(): TranscriptSegment[] {
    const record =
      this.openSegmentId === undefined
        ? undefined
        : this.records.get(this.openSegmentId);
    if (record === undefined) {
      return [];
    }
    const closed = this.close(record);
    return closed === undefined ? [] : [this.copy(closed)];
  }

  /**
   * Applies a human correction with optimistic concurrency control. Rejects
   * stale `expectedRevision` and keeps the previous revision in history.
   */
  correct(
    segmentId: string,
    text: string,
    expectedRevision: number,
  ): TranscriptSegment {
    const record = this.records.get(segmentId);
    if (record === undefined) {
      throw new SegmentNotFoundError(segmentId);
    }
    if (record.segment.revision !== expectedRevision) {
      throw new SegmentRevisionConflictError(
        segmentId,
        expectedRevision,
        record.segment.revision,
      );
    }
    const corrected = normalizeSpeechText(text);
    if (corrected.length === 0) {
      throw new SegmentCorrectionError(
        'A correção não pode ficar vazia (nenhum texto é descartado silenciosamente)',
      );
    }

    this.recordHistory(record);
    record.dependencies = [
      { kind: 'revision', segmentId, revision: record.segment.revision },
      ...record.windowIds.map(
        (windowId): SegmentDependency => ({ kind: 'window', windowId }),
      ),
    ];
    record.confirmedByHuman = true;
    record.segment = {
      ...record.segment,
      text: corrected,
      // The current revision is human-confirmed: `confidence` describes the
      // text we have now. The ASR confidence stays in `getHistory()`.
      confidence: 1,
      revision: record.segment.revision + 1,
    };
    this.touch(record);
    // Human confirmation clears text-derived uncertainty; structural problems
    // (e.g. overlapping audio flagged by the caller) remain.
    record.structuralReasons = record.structuralReasons.filter(
      (reason) => reason === 'OVERLAP' || reason === 'TRANSCRIPTION_ERROR',
    );
    record.segment =
      record.segment.status === 'PROVISIONAL'
        ? {
            ...record.segment,
            uncertaintyReasons: this.provisionalReasons(record),
          }
        : this.applyFinalState(record);
    this.touch(record);
    this.recordHistory(record);
    return this.copy(record.segment);
  }

  /** Segments whose change cursor is greater than `cursor`, oldest first. */
  /** Drops every segment and its history (DELETE_SESSION, LIVE-038). */
  clear(): void {
    this.records.clear();
    this.openSegmentId = undefined;
  }

  getSegments(cursor = 0): TranscriptSegment[] {
    return [...this.records.values()]
      .filter((record) => record.seq > cursor)
      .sort((left, right) => left.seq - right.seq)
      .map((record) => this.copy(record.segment));
  }

  /** Last change cursor (0 when nothing was pushed). */
  getCursor(): number {
    return this.seq;
  }

  getSegment(segmentId: string): TranscriptSegment | undefined {
    const record = this.records.get(segmentId);
    return record === undefined ? undefined : this.copy(record.segment);
  }

  /** Every current segment in creation order (for snapshots). */
  getAllSegments(): TranscriptSegment[] {
    return [...this.records.values()].map((record) =>
      this.copy(record.segment),
    );
  }

  /**
   * Recorded revisions of a segment, oldest first: every finalized revision and
   * every human correction (provisional updates are not archived).
   */
  getHistory(segmentId: string): SegmentHistoryEntry[] {
    const record = this.records.get(segmentId);
    if (record === undefined) {
      throw new SegmentNotFoundError(segmentId);
    }
    return record.history.map((entry) => ({
      ...entry,
      uncertaintyReasons: [...entry.uncertaintyReasons],
      dependencies: entry.dependencies.map((dependency) => ({ ...dependency })),
    }));
  }

  /** Dependencies of the current revision (previous revision + windows). */
  getDependencies(segmentId: string): SegmentDependency[] {
    const record = this.records.get(segmentId);
    if (record === undefined) {
      throw new SegmentNotFoundError(segmentId);
    }
    return record.dependencies.map((dependency) => ({ ...dependency }));
  }

  private nextWindowId(): string {
    const windowId = `${this.sessionId}-win-${String(this.nextWindowNumber)}`;
    this.nextWindowNumber += 1;
    return windowId;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private create(input: {
    text: string;
    startMs: number;
    endMs: number;
    confidence?: number;
    speakerId?: string;
    structural: UncertaintyReason[];
  }): SegmentRecord {
    const segmentId = `${this.sessionId}-seg-${String(this.nextSegmentNumber)}`;
    this.nextSegmentNumber += 1;
    const confidence = clampConfidence(input.confidence);
    const windowId = this.nextWindowId();
    const record: SegmentRecord = {
      segment: {
        id: segmentId,
        sessionId: this.sessionId,
        revision: 0,
        status: 'PROVISIONAL',
        text: input.text,
        ...(input.speakerId === undefined
          ? {}
          : { speakerId: input.speakerId }),
        startMs: input.startMs,
        endMs: input.endMs,
        ...(confidence === undefined ? {} : { confidence }),
        createdAt: this.clock().toISOString(),
      },
      seq: this.nextSeq(),
      windowIds: [windowId],
      structuralReasons: uniqueReasons(input.structural),
      history: [],
      dependencies: [{ kind: 'window', windowId }],
      confirmedByHuman: false,
    };
    record.segment = this.applyProvisionalState(record);
    this.records.set(segmentId, record);
    this.openSegmentId = segmentId;
    return record;
  }

  private touch(record: SegmentRecord): void {
    record.seq = this.nextSeq();
  }

  private textualReasons(record: SegmentRecord): UncertaintyReason[] {
    return record.confirmedByHuman
      ? []
      : detectUncertainty(record.segment.text, record.segment.confidence);
  }

  private provisionalReasons(record: SegmentRecord): UncertaintyReason[] {
    return uniqueReasons([
      ...record.structuralReasons,
      ...this.textualReasons(record),
    ]);
  }

  /**
   * Blocking policy (LIVE-005 / especificação §9 etapa 0):
   * - structural problems (`OVERLAP`, `TRANSCRIPTION_ERROR`) always block;
   * - low ASR confidence always blocks;
   * - critical words (numbers/negations) block while confidence is below the
   *   threshold, and also when confidence is unknown (conservative default).
   */
  private evaluate(record: SegmentRecord): {
    blocking: boolean;
    reasons: UncertaintyReason[];
  } {
    const confidence = record.segment.confidence;
    const textual = this.textualReasons(record);
    const reasons = uniqueReasons([...record.structuralReasons, ...textual]);
    const criticalTextual = textual.some(
      (reason) => reason === 'NUMBER' || reason === 'NEGATION',
    );
    const criticalWithoutConfidence =
      this.blockOnCriticalTokensWithoutConfidence &&
      confidence === undefined &&
      criticalTextual;
    const lowConfidence =
      confidence !== undefined && confidence < this.lowConfidenceThreshold;
    const structuralBlocking = reasons.some(
      (reason) => reason === 'OVERLAP' || reason === 'TRANSCRIPTION_ERROR',
    );
    return {
      blocking:
        lowConfidence || criticalWithoutConfidence || structuralBlocking,
      reasons,
    };
  }

  private applyProvisionalState(record: SegmentRecord): TranscriptSegment {
    const reasons = this.provisionalReasons(record);
    return {
      ...record.segment,
      status: 'PROVISIONAL',
      uncertaintyReasons: reasons.length > 0 ? reasons : undefined,
    };
  }

  private applyFinalState(record: SegmentRecord): TranscriptSegment {
    const { blocking, reasons } = this.evaluate(record);
    return {
      ...record.segment,
      status: blocking ? 'BLOCKED' : 'FINAL',
      uncertaintyReasons: reasons.length > 0 ? reasons : undefined,
    };
  }

  private close(record: SegmentRecord): TranscriptSegment | undefined {
    if (this.openSegmentId === record.segment.id) {
      this.openSegmentId = undefined;
    }
    const existing = record.segment;
    const finalized = this.applyFinalState(record);
    record.segment = {
      ...finalized,
      revision: existing.revision + (isOpenStatus(existing.status) ? 1 : 0),
    };
    this.touch(record);
    this.recordHistory(record);
    return record.segment;
  }

  private recordHistory(record: SegmentRecord): void {
    const entry: SegmentHistoryEntry = {
      segmentId: record.segment.id,
      revision: record.segment.revision,
      text: record.segment.text,
      status: record.segment.status,
      ...(record.segment.confidence === undefined
        ? {}
        : { confidence: record.segment.confidence }),
      uncertaintyReasons: [...(record.segment.uncertaintyReasons ?? [])],
      createdAt: record.segment.createdAt,
      dependencies: record.dependencies.map((dependency) => ({
        ...dependency,
      })),
    };
    const last = record.history.at(-1);
    if (last !== undefined && last.revision === entry.revision) {
      record.history[record.history.length - 1] = entry;
      return;
    }
    record.history.push(entry);
  }

  private copy(segment: TranscriptSegment): TranscriptSegment {
    return {
      ...segment,
      ...(segment.uncertaintyReasons === undefined
        ? {}
        : { uncertaintyReasons: [...segment.uncertaintyReasons] }),
    };
  }
}
