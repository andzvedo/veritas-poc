import type {
  Claim,
  SpeakerMapping,
  TranscriptSegment,
} from '@veritas/shared';

import { resolveSpeakerLabel, sortSegmentsBySpeechTime } from '../store/transcriptSync';

/**
 * Pure view model for the live transcript panel.
 *
 * The transcript shows only what was said: a neutral speaker heading and the
 * spoken text, with extracted claims highlighted inline (numbered, like the
 * text-mode results page). Analysis/quality metadata (segment status,
 * authorship gating, uncertainty reasons, revisions) is intentionally NOT part
 * of this model — it is summarised separately by `summarizeTranscriptGating`
 * and rendered next to the verification cards.
 */

export type SpeakerHeading =
  /** Confirmed participant name (LIVE-011). */
  | { kind: 'name'; name: string }
  /** Diarized but unconfirmed speaker: neutral ordinal, never a guessed name. */
  | { kind: 'ordinal'; ordinal: number }
  /** No diarization at all. */
  | { kind: 'participant' };

export type TranscriptPart =
  | { type: 'text'; text: string }
  | { type: 'claim'; claimId: string; number: number; text: string };

export interface TranscriptLine {
  segmentId: string;
  /** Only used for edit (LIVE-026/040); never rendered as text. */
  revision: number;
  provisional: boolean;
  startMs: number;
  endMs: number;
  /** Raw spoken text (source for corrections). */
  text: string;
  parts: TranscriptPart[];
  /** Claims linked to this segment whose quote was not found verbatim. */
  trailingClaims: Array<{ claimId: string; number: number; text: string }>;
}

export interface TranscriptBlock {
  key: string;
  speakerKey: string;
  heading: SpeakerHeading;
  lines: TranscriptLine[];
}

const NO_SPEAKER_KEY = '__no-speaker__';

function speakerKeyOf(segment: TranscriptSegment): string {
  const id = segment.speakerId?.trim();
  return id && id.length > 0 ? id : NO_SPEAKER_KEY;
}

function cleanQuote(value: string): string {
  return value.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

/** Case-insensitive locate of `needle` in `haystack`; returns -1 when absent. */
function locate(haystack: string, needle: string, from: number): number {
  if (needle.length === 0) return -1;
  return haystack.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase(), from);
}

/**
 * Assigns stable claim numbers in transcript order (first linked segment by
 * speech time, then claim timestamp, then id).
 */
export function numberClaims(
  segments: readonly TranscriptSegment[],
  claims: readonly Claim[],
): Map<string, number> {
  const order = new Map<string, number>();
  sortSegmentsBySpeechTime(segments).forEach((segment, index) => {
    order.set(segment.id, index);
  });

  const visible = claims
    .map((claim) => {
      const positions = claim.segmentIds
        .map((id) => order.get(id))
        .filter((value): value is number => value !== undefined);
      return { claim, first: positions.length > 0 ? Math.min(...positions) : -1 };
    })
    .filter((item) => item.first >= 0)
    .sort((a, b) => {
      if (a.first !== b.first) return a.first - b.first;
      const at = a.claim.timestampMs?.start ?? 0;
      const bt = b.claim.timestampMs?.start ?? 0;
      if (at !== bt) return at - bt;
      return a.claim.id.localeCompare(b.claim.id);
    });

  const numbers = new Map<string, number>();
  visible.forEach((item, index) => numbers.set(item.claim.id, index + 1));
  return numbers;
}

type ClaimPlacement = { segmentId: string; inline: boolean };

/**
 * Decides where each claim is shown: inline in the first segment (speech
 * order) whose text contains its quote, otherwise as a highlighted line after
 * its last linked segment (quote spans segments or was normalised).
 */
function placeClaims(
  ordered: readonly TranscriptSegment[],
  claims: readonly Claim[],
  numbers: Map<string, number>,
): Map<string, ClaimPlacement> {
  const placements = new Map<string, ClaimPlacement>();
  for (const claim of claims) {
    if (!numbers.has(claim.id)) continue;
    const quote = cleanQuote(claim.originalQuote);
    const linked = ordered.filter((segment) => claim.segmentIds.includes(segment.id));
    const hit = linked.find((segment) => locate(segment.text, quote, 0) !== -1);
    if (hit) {
      placements.set(claim.id, { segmentId: hit.id, inline: true });
    } else if (linked.length > 0) {
      placements.set(claim.id, { segmentId: linked[linked.length - 1].id, inline: false });
    }
  }
  return placements;
}

function buildLine(
  segment: TranscriptSegment,
  claims: readonly Claim[],
  numbers: Map<string, number>,
  placements: Map<string, ClaimPlacement>,
): TranscriptLine {
  const here = claims
    .filter((claim) => placements.get(claim.id)?.segmentId === segment.id)
    .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));

  const text = segment.text;
  const matches: Array<{ start: number; end: number; claim: Claim }> = [];
  const trailing: TranscriptLine['trailingClaims'] = [];

  for (const claim of here) {
    const number = numbers.get(claim.id) ?? 0;
    const quote = cleanQuote(claim.originalQuote);
    let start = placements.get(claim.id)?.inline ? locate(text, quote, 0) : -1;
    // Skip overlaps with an already-matched claim.
    while (
      start !== -1 &&
      matches.some((m) => start < m.end && start + quote.length > m.start)
    ) {
      start = locate(text, quote, start + 1);
    }
    if (start === -1) {
      trailing.push({ claimId: claim.id, number, text: claim.normalizedClaim });
    } else {
      matches.push({ start, end: start + quote.length, claim });
    }
  }

  matches.sort((a, b) => a.start - b.start);
  const parts: TranscriptPart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, match.start) });
    }
    parts.push({
      type: 'claim',
      claimId: match.claim.id,
      number: numbers.get(match.claim.id) ?? 0,
      text: text.slice(match.start, match.end),
    });
    cursor = match.end;
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) });

  return {
    segmentId: segment.id,
    revision: segment.revision,
    provisional: segment.status === 'PROVISIONAL',
    startMs: segment.startMs,
    endMs: segment.endMs,
    text,
    parts,
    trailingClaims: trailing,
  };
}

/**
 * Groups consecutive segments of the same speaker under one heading and
 * splits each segment's text into plain/claim parts.
 */
export function buildTranscriptBlocks(
  segments: readonly TranscriptSegment[],
  claims: readonly Claim[],
  mappings: readonly SpeakerMapping[],
): TranscriptBlock[] {
  const ordered = sortSegmentsBySpeechTime(segments);
  const numbers = numberClaims(ordered, claims);
  const ordinals = new Map<string, number>();
  const placements = placeClaims(ordered, claims, numbers);
  const blocks: TranscriptBlock[] = [];

  for (const segment of ordered) {
    const speakerKey = speakerKeyOf(segment);
    let heading: SpeakerHeading;
    if (speakerKey === NO_SPEAKER_KEY) {
      heading = { kind: 'participant' };
    } else {
      const resolved = resolveSpeakerLabel(segment.speakerId, mappings);
      if (resolved.known && resolved.confirmed && resolved.label) {
        heading = { kind: 'name', name: resolved.label };
      } else {
        if (!ordinals.has(speakerKey)) ordinals.set(speakerKey, ordinals.size + 1);
        heading = { kind: 'ordinal', ordinal: ordinals.get(speakerKey) ?? 1 };
      }
    }

    const line = buildLine(segment, claims, numbers, placements);
    const last = blocks[blocks.length - 1];
    if (last && last.speakerKey === speakerKey && sameHeading(last.heading, heading)) {
      last.lines.push(line);
    } else {
      blocks.push({ key: `${speakerKey}-${segment.id}`, speakerKey, heading, lines: [line] });
    }
  }

  return blocks;
}

function sameHeading(a: SpeakerHeading, b: SpeakerHeading): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'name' && b.kind === 'name') return a.name === b.name;
  if (a.kind === 'ordinal' && b.kind === 'ordinal') return a.ordinal === b.ordinal;
  return true;
}

export interface TranscriptGatingSummary {
  /** Segments not verified because the speaker is unknown/unconfirmed. */
  unknownAuthorship: number;
  /** Segments blocked for any reason (status BLOCKED). */
  blocked: number;
  uncertainNumber: number;
  uncertainNegation: number;
  /** Other uncertainty reasons (subject, overlap, low confidence, error). */
  otherUncertain: number;
}

/**
 * Quality / gating info that used to clutter the transcript. Rendered in the
 * verification side panel instead (LIVE-007/026/040).
 */
export function summarizeTranscriptGating(
  segments: readonly TranscriptSegment[],
  mappings: readonly SpeakerMapping[],
): TranscriptGatingSummary {
  const summary: TranscriptGatingSummary = {
    unknownAuthorship: 0,
    blocked: 0,
    uncertainNumber: 0,
    uncertainNegation: 0,
    otherUncertain: 0,
  };

  for (const segment of segments) {
    const speaker = resolveSpeakerLabel(segment.speakerId, mappings);
    const unknown = !(speaker.known && speaker.confirmed);
    if (segment.status === 'BLOCKED') {
      summary.blocked += 1;
      if (unknown) summary.unknownAuthorship += 1;
    }
    const reasons = segment.uncertaintyReasons ?? [];
    if (reasons.includes('NUMBER')) summary.uncertainNumber += 1;
    if (reasons.includes('NEGATION')) summary.uncertainNegation += 1;
    if (reasons.some((reason) => reason !== 'NUMBER' && reason !== 'NEGATION')) {
      summary.otherUncertain += 1;
    }
  }

  return summary;
}

export function hasGatingInfo(summary: TranscriptGatingSummary): boolean {
  return (
    summary.blocked > 0 ||
    summary.uncertainNumber > 0 ||
    summary.uncertainNegation > 0 ||
    summary.otherUncertain > 0
  );
}
