/**
 * In-session revision ledger (LIVE-040).
 *
 * Keeps the audit trail of one live session in memory: automated attempts
 * (with the input revisions they depended on), invalidations, human reviews
 * and purely typographic corrections. It also owns the monotonic revision of
 * every verification id so that an invalidation always supersedes the result
 * it cancels and a re-attempt always supersedes the invalidation.
 *
 * Retention (P0): memory only, capped per verification and per session. When
 * a cap drops records the `truncated` counter says so — nothing is removed
 * silently. Nothing here survives a process restart (documented in
 * docs/LIVE-SEGURANCA-RETENCAO.md).
 */
import type {
  HumanReviewDecision,
  HumanReviewRecord,
  InvalidationCause,
  RevisionDiff,
  SessionAudit,
  TextChangeKind,
  TypographicCorrectionRecord,
  Verdict,
  VerificationAttemptRecord,
  VerificationAttemptStatus,
  VerificationInputs,
  VerificationInvalidationRecord,
} from '@veritas/shared';

export const DEFAULT_MAX_ATTEMPTS_PER_VERIFICATION = 20;
export const DEFAULT_MAX_AUDIT_RECORDS = 2_000;

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly currentRevision: number | undefined;

  constructor(
    entity: string,
    expectedRevision: number,
    currentRevision: number | undefined,
  ) {
    super(
      currentRevision === undefined
        ? `Conflito de revisão em "${entity}": não há versão atual para revisar.`
        : `Conflito de revisão em "${entity}": esperado ${String(expectedRevision)}, atual ${String(currentRevision)}.`,
    );
    this.name = 'RevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

// ===== Text change classification =====
const NEGATION_WORDS = new Set([
  'não',
  'nao',
  'nunca',
  'jamais',
  'nem',
  'nenhum',
  'nenhuma',
  'ninguém',
  'ninguem',
  'nada',
  'sem',
]);

const NUMBER_WORDS = new Set([
  'zero',
  'um',
  'uma',
  'dois',
  'duas',
  'três',
  'tres',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
  'cem',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'mil',
  'milhão',
  'milhao',
  'milhões',
  'milhoes',
  'bilhão',
  'bilhao',
  'bilhões',
  'bilhoes',
  'trilhão',
  'trilhões',
  'metade',
  'dobro',
  'triplo',
  'porcento',
  '%',
]);

/**
 * Typographic normalization: lower case, collapsed whitespace and punctuation
 * removed — except punctuation between digits ("1.000", "3,5"), which changes
 * the number and therefore is NOT typographic.
 */
export function normalizeTypography(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    // Keep the exact separator: "1.000" and "1,000" are different numbers.
    .replace(/(\d)\.(?=\d)/gu, '$1\uE000')
    .replace(/(\d),(?=\d)/gu, '$1\uE001')
    .replace(/%/gu, ' % ')
    .replace(/[^\p{L}\p{N}\uE000\uE001%\s]/gu, ' ')
    .replace(/\uE000/gu, '.')
    .replace(/\uE001/gu, ',')
    .replace(/\s+/gu, ' ')
    .trim();
}

const tokens = (text: string): string[] =>
  normalizeTypography(text)
    .split(' ')
    .filter((token) => token.length > 0);

const multiset = (items: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
};

const sameMultiset = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  const a = multiset(left);
  const b = multiset(right);
  for (const [key, count] of a) {
    if (b.get(key) !== count) {
      return false;
    }
  }
  return true;
};

const isNumberToken = (token: string): boolean =>
  /\d/u.test(token) || NUMBER_WORDS.has(token);

/**
 * Classifies a text change. Only `['TYPOGRAPHIC']` keeps dependent results;
 * any NUMBER / NEGATION / WORDING change invalidates them (LIVE-040).
 */
export function classifyTextChange(
  before: string,
  after: string,
): TextChangeKind[] {
  const left = tokens(before);
  const right = tokens(after);
  if (left.join(' ') === right.join(' ')) {
    return ['TYPOGRAPHIC'];
  }
  const kinds: TextChangeKind[] = [];
  if (
    left.filter(isNumberToken).join(' ') !==
    right.filter(isNumberToken).join(' ')
  ) {
    kinds.push('NUMBER');
  }
  const negLeft = left.filter((token) => NEGATION_WORDS.has(token));
  const negRight = right.filter((token) => NEGATION_WORDS.has(token));
  if (!sameMultiset(negLeft, negRight)) {
    kinds.push('NEGATION');
  }
  const restLeft = left.filter(
    (token) => !isNumberToken(token) && !NEGATION_WORDS.has(token),
  );
  const restRight = right.filter(
    (token) => !isNumberToken(token) && !NEGATION_WORDS.has(token),
  );
  if (restLeft.join(' ') !== restRight.join(' ') || kinds.length === 0) {
    kinds.push('WORDING');
  }
  return kinds;
}

export const isTypographicOnly = (kinds: readonly TextChangeKind[]): boolean =>
  kinds.length === 1 && kinds[0] === 'TYPOGRAPHIC';

// ===== Ledger =====
export type RevisionLedgerOptions = {
  now?: () => Date;
  maxAttemptsPerVerification?: number;
  maxAuditRecords?: number;
  idFactory?: (prefix: string) => string;
};

export type StartAttemptArgs = {
  verificationId: string;
  claimId: string;
  inputs: VerificationInputs;
};

export type InvalidateArgs = {
  verificationId: string;
  claimId: string;
  cause: InvalidationCause;
  reason: string;
  /** Lower bound for the new revision (e.g. the current claim revision). */
  floorRevision?: number;
  previousVerdict?: Verdict;
  diff?: RevisionDiff;
};

export class RevisionLedger {
  private readonly now: () => Date;
  private readonly maxAttemptsPerVerification: number;
  private readonly maxAuditRecords: number;
  private readonly idFactory: (prefix: string) => string;

  private readonly attempts = new Map<string, VerificationAttemptRecord[]>();
  /** verificationId → attempt id that may still publish a result. */
  private readonly currentAttempt = new Map<string, string>();
  private readonly lastRevision = new Map<string, number>();
  private readonly invalidations: VerificationInvalidationRecord[] = [];
  private readonly humanReviews: HumanReviewRecord[] = [];
  private readonly typographic: TypographicCorrectionRecord[] = [];
  private truncated = 0;
  private seq = 0;

  constructor(options: RevisionLedgerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxAttemptsPerVerification = Math.max(
      1,
      options.maxAttemptsPerVerification ??
        DEFAULT_MAX_ATTEMPTS_PER_VERIFICATION,
    );
    this.maxAuditRecords = Math.max(
      1,
      options.maxAuditRecords ?? DEFAULT_MAX_AUDIT_RECORDS,
    );
    this.idFactory =
      options.idFactory ??
      ((prefix) => `${prefix}-${String(++this.seq)}`);
  }

  getLimits(): { maxAttemptsPerVerification: number; maxAuditRecords: number } {
    return {
      maxAttemptsPerVerification: this.maxAttemptsPerVerification,
      maxAuditRecords: this.maxAuditRecords,
    };
  }

  /** Next monotonic revision of a verification id (strictly increasing). */
  nextRevision(verificationId: string, floor = -1): number {
    const last = this.lastRevision.get(verificationId) ?? -1;
    const next = Math.max(last, floor) + 1;
    this.lastRevision.set(verificationId, next);
    return next;
  }

  getLastRevision(verificationId: string): number | undefined {
    return this.lastRevision.get(verificationId);
  }

  /** Opens a new automated attempt; any previous running one is superseded. */
  startAttempt(args: StartAttemptArgs): VerificationAttemptRecord {
    const list = this.attempts.get(args.verificationId) ?? [];
    const previousId = this.currentAttempt.get(args.verificationId);
    if (previousId !== undefined) {
      this.finishAttempt(previousId, 'SUPERSEDED', {
        reason: 'Substituída por nova tentativa',
        onlyIfRunning: true,
      });
    }
    const attempt: VerificationAttemptRecord = {
      id: this.idFactory(`attempt-${args.claimId}`),
      verificationId: args.verificationId,
      claimId: args.claimId,
      attemptNumber: (list.at(-1)?.attemptNumber ?? 0) + 1,
      inputs: structuredClone(args.inputs),
      status: 'RUNNING',
      reviewType: 'AUTOMATED',
      startedAt: this.now().toISOString(),
    };
    list.push(attempt);
    while (list.length > this.maxAttemptsPerVerification) {
      list.shift();
      this.truncated += 1;
    }
    this.attempts.set(args.verificationId, list);
    this.currentAttempt.set(args.verificationId, attempt.id);
    return { ...attempt };
  }

  /** True only for the attempt allowed to publish the current result. */
  isCurrentAttempt(verificationId: string, attemptId: string): boolean {
    return this.currentAttempt.get(verificationId) === attemptId;
  }

  getAttempt(attemptId: string): VerificationAttemptRecord | undefined {
    for (const list of this.attempts.values()) {
      const found = list.find((attempt) => attempt.id === attemptId);
      if (found !== undefined) {
        return { ...found };
      }
    }
    return undefined;
  }

  getAttempts(verificationId: string): VerificationAttemptRecord[] {
    return (this.attempts.get(verificationId) ?? []).map((attempt) => ({
      ...attempt,
    }));
  }

  finishAttempt(
    attemptId: string,
    status: Exclude<VerificationAttemptStatus, 'RUNNING'>,
    details: {
      verdict?: Verdict;
      reason?: string;
      resultRevision?: number;
      onlyIfRunning?: boolean;
    } = {},
  ): VerificationAttemptRecord | undefined {
    for (const [verificationId, list] of this.attempts) {
      const attempt = list.find((item) => item.id === attemptId);
      if (attempt === undefined) {
        continue;
      }
      if (details.onlyIfRunning === true && attempt.status !== 'RUNNING') {
        return { ...attempt };
      }
      attempt.status = status;
      attempt.finishedAt = this.now().toISOString();
      if (details.verdict !== undefined) {
        attempt.verdict = details.verdict;
      }
      if (details.reason !== undefined) {
        attempt.reason = details.reason;
      }
      if (details.resultRevision !== undefined) {
        attempt.resultRevision = details.resultRevision;
      }
      if (
        status !== 'COMPLETED' &&
        status !== 'FAILED' &&
        status !== 'DEFERRED' &&
        this.currentAttempt.get(verificationId) === attemptId
      ) {
        this.currentAttempt.delete(verificationId);
      }
      return { ...attempt };
    }
    return undefined;
  }

  /**
   * Records an invalidation: the current attempt can no longer publish and
   * the returned revision supersedes every earlier one.
   */
  invalidate(args: InvalidateArgs): VerificationInvalidationRecord {
    const attemptId = this.currentAttempt.get(args.verificationId);
    if (attemptId !== undefined) {
      const attempt = this.getAttempt(attemptId);
      this.finishAttempt(
        attemptId,
        attempt?.status === 'RUNNING' ? 'CANCELLED' : 'SUPERSEDED',
        { reason: args.reason, onlyIfRunning: false },
      );
      this.currentAttempt.delete(args.verificationId);
    }
    const record: VerificationInvalidationRecord = {
      verificationId: args.verificationId,
      claimId: args.claimId,
      revision: this.nextRevision(args.verificationId, args.floorRevision),
      cause: args.cause,
      reason: args.reason,
      invalidatedAt: this.now().toISOString(),
      ...(attemptId === undefined ? {} : { attemptId }),
      ...(args.previousVerdict === undefined
        ? {}
        : { previousVerdict: args.previousVerdict }),
      ...(args.diff === undefined ? {} : { diff: structuredClone(args.diff) }),
    };
    this.pushCapped(this.invalidations, record);
    return { ...record };
  }

  /** Latest invalidation per verification id (for snapshot replay). */
  latestInvalidations(): VerificationInvalidationRecord[] {
    const latest = new Map<string, VerificationInvalidationRecord>();
    for (const record of this.invalidations) {
      const existing = latest.get(record.verificationId);
      if (existing === undefined || record.revision > existing.revision) {
        latest.set(record.verificationId, record);
      }
    }
    return [...latest.values()].map((record) => ({ ...record }));
  }

  getInvalidations(verificationId?: string): VerificationInvalidationRecord[] {
    return this.invalidations
      .filter(
        (record) =>
          verificationId === undefined ||
          record.verificationId === verificationId,
      )
      .map((record) => ({ ...record }));
  }

  /**
   * Human review is a separate record: it never changes the automated
   * verdict and is rejected when the reviewer saw a stale revision.
   */
  addHumanReview(args: {
    verificationId: string;
    currentRevision: number | undefined;
    expectedRevision: number;
    decision: HumanReviewDecision;
    note?: string;
  }): HumanReviewRecord {
    if (
      args.currentRevision === undefined ||
      args.currentRevision !== args.expectedRevision
    ) {
      throw new RevisionConflictError(
        args.verificationId,
        args.expectedRevision,
        args.currentRevision,
      );
    }
    const record: HumanReviewRecord = {
      id: this.idFactory(`review-${args.verificationId}`),
      verificationId: args.verificationId,
      verificationRevision: args.currentRevision,
      reviewType: 'HUMAN',
      decision: args.decision,
      ...(args.note === undefined || args.note.trim().length === 0
        ? {}
        : { note: args.note.trim() }),
      reviewedAt: this.now().toISOString(),
    };
    this.pushCapped(this.humanReviews, record);
    return { ...record };
  }

  recordTypographicCorrection(args: {
    segmentId: string;
    fromRevision: number;
    toRevision: number;
    diff: RevisionDiff;
  }): TypographicCorrectionRecord {
    const record: TypographicCorrectionRecord = {
      segmentId: args.segmentId,
      fromRevision: args.fromRevision,
      toRevision: args.toRevision,
      decision: 'KEEP_RESULTS',
      recordedAt: this.now().toISOString(),
      diff: structuredClone(args.diff),
    };
    this.pushCapped(this.typographic, record);
    return { ...record };
  }

  getAudit(): SessionAudit {
    return {
      attempts: [...this.attempts.values()].flatMap((list) =>
        list.map((attempt) => ({ ...attempt })),
      ),
      invalidations: this.getInvalidations(),
      humanReviews: this.humanReviews.map((record) => ({ ...record })),
      typographicCorrections: this.typographic.map((record) => ({
        ...record,
      })),
      truncated: this.truncated,
    };
  }

  /** Drops every record (DELETE_SESSION / expiry). */
  clear(): void {
    this.attempts.clear();
    this.currentAttempt.clear();
    this.lastRevision.clear();
    this.invalidations.length = 0;
    this.humanReviews.length = 0;
    this.typographic.length = 0;
    this.truncated = 0;
  }

  private pushCapped<T>(list: T[], record: T): void {
    list.push(record);
    while (list.length > this.maxAuditRecords) {
      list.shift();
      this.truncated += 1;
    }
  }
}
