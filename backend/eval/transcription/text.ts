/**
 * Pure text metrics for transcription evaluation: tokenization, Levenshtein
 * alignment (WER/CER) and critical-term checks (names, numbers, dates,
 * percentages, units and negations).
 */
import type { CriticalTerm } from './types.js';

const TOKEN_PATTERN = /r\$|[\p{L}\p{N}]+(?:[.,:/][\p{N}]+)*%?|%/gu;

/** Lowercased word tokens; punctuation dropped, diacritics kept. */
export function tokenize(text: string): string[] {
  return text.normalize('NFC').toLowerCase().match(TOKEN_PATTERN) ?? [];
}

/** Lowercased, punctuation-free character string for CER (single spaces). */
export function normalizeForCer(text: string): string {
  return tokenize(text).join(' ');
}

export type EditCounts = {
  substitutions: number;
  deletions: number;
  insertions: number;
  /** Reference length (denominator). */
  referenceLength: number;
};

export function editCounts<T>(
  reference: readonly T[],
  hypothesis: readonly T[],
): EditCounts {
  const rows = reference.length + 1;
  const cols = hypothesis.length + 1;
  // dp[i][j] = [cost, subs, dels, ins]
  const dp: [number, number, number, number][][] = [];
  for (let i = 0; i < rows; i++) {
    const row: [number, number, number, number][] = [];
    for (let j = 0; j < cols; j++) {
      if (i === 0) {
        row.push([j, 0, 0, j]);
      } else if (j === 0) {
        row.push([i, 0, i, 0]);
      } else {
        row.push([0, 0, 0, 0]);
      }
    }
    dp.push(row);
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = reference[i - 1] === hypothesis[j - 1];
      const diag = dp[i - 1][j - 1];
      const up = dp[i - 1][j];
      const left = dp[i][j - 1];
      const options: [number, number, number, number][] = [
        same
          ? [diag[0], diag[1], diag[2], diag[3]]
          : [diag[0] + 1, diag[1] + 1, diag[2], diag[3]],
        [up[0] + 1, up[1], up[2] + 1, up[3]],
        [left[0] + 1, left[1], left[2], left[3] + 1],
      ];
      options.sort((a, b) => a[0] - b[0]);
      dp[i][j] = options[0]!;
    }
  }
  const last = dp[rows - 1][cols - 1];
  return {
    substitutions: last[1],
    deletions: last[2],
    insertions: last[3],
    referenceLength: reference.length,
  };
}

export function totalEdits(counts: EditCounts): number {
  return counts.substitutions + counts.deletions + counts.insertions;
}

export function wordEdits(reference: string, hypothesis: string): EditCounts {
  return editCounts(tokenize(reference), tokenize(hypothesis));
}

export function charEdits(reference: string, hypothesis: string): EditCounts {
  return editCounts(
    [...normalizeForCer(reference)],
    [...normalizeForCer(hypothesis)],
  );
}

function countSequence(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) {
        match = false;
        break;
      }
    }
    if (match) {
      count += 1;
    }
  }
  return count;
}

function occurrences(tokens: readonly string[], term: CriticalTerm): number {
  const forms = [term.text, ...term.accept].map((form) => tokenize(form));
  return forms.reduce((sum, form) => sum + countSequence(tokens, form), 0);
}

export type CriticalTermOutcome = {
  term: CriticalTerm;
  /** Occurrences in the reference (0 only for an absent negation). */
  referenceCount: number;
  /** Denominator slots: `max(1, referenceCount)`. */
  slots: number;
  hypothesisCount: number;
  /** Missing, altered or (for negations) inserted occurrences. */
  errors: number;
};

/**
 * Compares critical-term occurrences between reference and hypothesis.
 * Every missing occurrence is an error; for negations an extra occurrence in
 * the hypothesis is also an error (an inserted "não" flips the claim). A
 * negation annotated on a reference without "não" guards against insertion.
 */
export function criticalTermOutcomes(
  reference: string,
  hypothesis: string,
  terms: readonly CriticalTerm[],
): CriticalTermOutcome[] {
  const refTokens = tokenize(reference);
  const hypTokens = tokenize(hypothesis);
  return terms.map((term) => {
    const referenceCount = occurrences(refTokens, term);
    const hypothesisCount = occurrences(hypTokens, term);
    const missing = Math.max(0, referenceCount - hypothesisCount);
    const inserted =
      term.category === 'NEGATION'
        ? Math.max(0, hypothesisCount - referenceCount)
        : 0;
    return {
      term,
      referenceCount,
      slots: Math.max(1, referenceCount),
      hypothesisCount,
      errors: missing + inserted,
    };
  });
}
