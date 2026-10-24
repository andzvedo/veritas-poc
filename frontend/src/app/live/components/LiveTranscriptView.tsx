"use client";

import React from 'react';
import { AlertTriangle, AudioLines, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shared/components/ui/button';
import type { TranslationKeys } from '@/lib/i18n/types';
import type {
  SpeakerHeading,
  TranscriptBlock,
  TranscriptLine,
} from '@/lib/live/transcriptView';
import { formatSpeechTimestamp } from '@/lib/store/transcriptSync';

type TranscriptStrings = TranslationKeys['live']['transcript'];

export interface LiveTranscriptViewProps {
  blocks: TranscriptBlock[];
  strings: TranscriptStrings;
  cancelLabel: string;
  /** Number of signalled audio gaps (shown as a discreet header badge only). */
  gapCount?: number;
  /** Segment ids with a revision conflict (non-text affordance on the edit icon). */
  conflictSegmentIds?: readonly string[];
  /** Whether corrections are possible (an active session exists). */
  canCorrect?: boolean;
  editingSegmentId?: string | null;
  draft?: string;
  selectedClaimId?: string;
  onDraftChange?: (value: string) => void;
  onStartEdit?: (line: TranscriptLine) => void;
  onSubmitEdit?: (line: TranscriptLine) => void;
  onCancelEdit?: () => void;
  onClaimClick?: (claimId: string) => void;
  className?: string;
}

function headingLabel(heading: SpeakerHeading, strings: TranscriptStrings): string {
  switch (heading.kind) {
    case 'name':
      return heading.name;
    case 'ordinal':
      return strings.speakerOrdinal.replace('{{n}}', String(heading.ordinal));
    case 'participant':
      return strings.speakerParticipant;
    default: {
      const _exhaustive: never = heading;
      void _exhaustive;
      return strings.speakerParticipant;
    }
  }
}

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const last = words[words.length - 1];
  if (words.length > 1 && /^\d+$/.test(last)) return `${words[0][0]}${last}`.toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

interface ClaimMarkProps {
  claimId: string;
  number: number;
  text: string;
  selected: boolean;
  label: string;
  onClick?: (claimId: string) => void;
}

/** Inline numbered purple highlight — same look as text-mode InteractiveText. */
const ClaimMark: React.FC<ClaimMarkProps> = ({
  claimId,
  number,
  text,
  selected,
  label,
  onClick,
}) => (
  <button
    type="button"
    id={`claim-${claimId}`}
    data-slot="transcript-claim"
    aria-label={label}
    onClick={() => onClick?.(claimId)}
    className={cn(
      'inline cursor-pointer rounded text-left align-baseline transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d13dd]/50',
      selected && 'ring-2 ring-purple-500/50',
    )}
  >
    <span className="text-[#5d13dd] font-semibold text-sm mr-1">{number}.</span>
    <span className="font-medium px-1 py-0.5 rounded text-[#5d13dd] bg-purple-50 hover:bg-purple-100 [box-decoration-break:clone]">
      {text}
    </span>
  </button>
);

/**
 * Presentational live transcript: speaker heading + exactly what was said,
 * with extracted claims highlighted inline. No status, authorship, uncertainty
 * or revision metadata is rendered here by design.
 */
const LiveTranscriptView: React.FC<LiveTranscriptViewProps> = ({
  blocks,
  strings,
  cancelLabel,
  gapCount = 0,
  conflictSegmentIds = [],
  canCorrect = false,
  editingSegmentId = null,
  draft = '',
  selectedClaimId,
  onDraftChange,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
  onClaimClick,
  className,
}) => {
  const claimLabel = (number: number) =>
    strings.claimLinkLabel.replace('{{n}}', String(number));

  return (
    <section
      className={cn(
        'flex flex-col bg-white border border-[#dfdbe5] rounded-[19px] overflow-hidden shadow-[0_8px_36px_rgba(31,14,57,0.04)] min-h-[320px]',
        className,
      )}
      data-slot="live-transcript"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#ece8f2]">
        <h2 className="inline-flex items-center gap-2 text-sm font-bold text-[#292236]">
          <AudioLines className="size-4 text-[#731fb8]" />
          {strings.title}
        </h2>
        <div className="flex items-center gap-2">
          {gapCount > 0 && (
            <span
              role="status"
              data-slot="transcript-gaps"
              title={strings.gapsNotice.replace('{{count}}', String(gapCount))}
              className="inline-flex items-center gap-1 text-[11px] text-[#9a8fa6]"
            >
              <AlertTriangle className="size-3" aria-hidden />
              {strings.gapsBadge.replace('{{count}}', String(gapCount))}
            </span>
          )}
          <span className="text-xs text-[#81788b]">{strings.subtitle}</span>
        </div>
      </header>

      <div
        className="flex-1 overflow-y-auto px-5 py-4 max-h-[min(60vh,560px)]"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 min-h-[240px] text-[#81788b] text-sm text-center px-4">
            <AudioLines className="size-8 opacity-50" />
            <p>{strings.empty}</p>
          </div>
        ) : (
          <div className="space-y-4 [font-family:var(--font-merriweather)]">
            {blocks.map((block) => {
              const label = headingLabel(block.heading, strings);
              return (
                <div key={block.key} data-slot="transcript-block">
                  <p
                    className="flex items-center gap-2 mb-1 text-[13px] text-zinc-500"
                    data-slot="transcript-speaker"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-5 items-center justify-center rounded-full bg-[#ede7f7] text-[9px] font-bold text-[#5d13dd] [font-family:var(--font-inter)]"
                    >
                      {initials(label)}
                    </span>
                    {label}
                  </p>

                  <div className="space-y-2">
                    {block.lines.map((line) => {
                      const isEditing = editingSegmentId === line.segmentId;
                      const hasConflict = conflictSegmentIds.includes(line.segmentId);
                      const timeRange = `${formatSpeechTimestamp(line.startMs)} – ${formatSpeechTimestamp(line.endMs)}`;

                      if (isEditing) {
                        return (
                          <div
                            key={line.segmentId}
                            id={`transcript-segment-${line.segmentId}`}
                            className="space-y-2"
                          >
                            <textarea
                              value={draft}
                              onChange={(event) => onDraftChange?.(event.target.value)}
                              className="w-full min-h-[72px] rounded-lg border border-[#d7d4de] bg-white p-2 text-sm text-[#292236]"
                              aria-label={strings.correctLabel}
                            />
                            {hasConflict && (
                              <p className="text-[11px] text-[#b45309] [font-family:var(--font-inter)]">
                                {strings.revisionConflict}
                              </p>
                            )}
                            <div className="flex gap-2 [font-family:var(--font-inter)]">
                              <Button
                                size="sm"
                                variant="filled"
                                onClick={() => onSubmitEdit?.(line)}
                              >
                                {strings.saveCorrection}
                              </Button>
                              <Button size="sm" variant="outlined" onClick={onCancelEdit}>
                                {cancelLabel}
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={line.segmentId}
                          id={`transcript-segment-${line.segmentId}`}
                          data-slot="transcript-line"
                          className="group relative pr-7"
                        >
                          <p
                            title={`${timeRange} · ${strings.speechTimeHint}`}
                            className={cn(
                              'text-sm font-normal leading-7 tracking-tight text-zinc-500 whitespace-pre-wrap',
                              line.provisional && 'text-zinc-400',
                            )}
                          >
                            {line.parts.map((part, index) =>
                              part.type === 'text' ? (
                                <span key={`t-${index}`}>{part.text}</span>
                              ) : (
                                <ClaimMark
                                  key={`c-${part.claimId}`}
                                  claimId={part.claimId}
                                  number={part.number}
                                  text={part.text}
                                  label={claimLabel(part.number)}
                                  selected={selectedClaimId === part.claimId}
                                  onClick={onClaimClick}
                                />
                              ),
                            )}
                          </p>
                          {line.trailingClaims.map((claim) => (
                            <p key={claim.claimId} className="text-sm leading-7 pl-1">
                              <ClaimMark
                                claimId={claim.claimId}
                                number={claim.number}
                                text={claim.text}
                                label={claimLabel(claim.number)}
                                selected={selectedClaimId === claim.claimId}
                                onClick={onClaimClick}
                              />
                            </p>
                          ))}
                          {canCorrect && (
                            <button
                              type="button"
                              onClick={() => onStartEdit?.(line)}
                              aria-label={
                                hasConflict
                                  ? `${strings.correct} (${strings.revisionConflict})`
                                  : strings.correct
                              }
                              title={
                                hasConflict
                                  ? `${strings.correct} (${strings.revisionConflict})`
                                  : strings.correct
                              }
                              data-slot="transcript-edit"
                              className={cn(
                                'absolute right-0 top-1 inline-flex size-6 items-center justify-center rounded-md text-[#8a5cda] transition-opacity',
                                'hover:bg-[#f5f0ff] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d13dd]/40',
                                hasConflict
                                  ? 'opacity-100 text-[#b45309]'
                                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                              )}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export default LiveTranscriptView;
