'use client';

import * as React from 'react';
import { CircleAlert, Clock, Info, Search, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ClaimStatus, Verification } from '@veritas/shared';

import { cn } from '@/lib/utils';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { interpolate, useI18n } from '@/lib/i18n/I18nContext';
import {
  deriveContradiction,
  deriveWhatFound,
  deriveWhatSaid,
  formatTimestamp,
  getDisplayVerdict,
  getLimitations,
  getMechanismEvidence,
  getMechanismLabel,
  getSpeakerLabel,
  getSupportedAspects,
  isDefinitive,
} from '@/lib/verification/presentation';

import EvidenceDisclosure from './EvidenceDisclosure';
import VerdictBadge from './VerdictBadge';

export interface VerificationCardProps {
  verification: Verification;
  /** Expands layer 3 (evidence) on first render. */
  defaultOpen?: boolean;
  /** Called with the verification id when the card or its select button is activated. */
  onSelect?: (verificationId: string) => void;
  className?: string;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-button)] focus-visible:ring-offset-2';

const WARNING_TEXT =
  'text-[color-mix(in_srgb,var(--warning-amber)_80%,#111827)]';
const SECTION_LABEL =
  'text-[10px] font-bold uppercase tracking-[0.085em] text-[var(--purple-medium)]';

type NoticeStatus = Exclude<ClaimStatus, 'COMPLETED'> | 'incomplete';

const NOTICE_ICONS: Record<NoticeStatus, LucideIcon> = {
  DETECTED: Clock,
  QUEUED: Clock,
  RESEARCHING: Search,
  EVALUATING: Search,
  BLOCKED: TriangleAlert,
  FAILED: CircleAlert,
  CANCELLED: Info,
  DEFERRED: Clock,
  incomplete: Info,
};

const NOTICE_BASE = 'border-[var(--divider)] bg-[#f8f7fa] text-[var(--text-secondary)]';
const NOTICE_NEUTRAL = 'border-[var(--divider)] bg-[var(--bg-overlay)] text-[var(--text-secondary)]';
const NOTICE_WARNING =
  'border-[color-mix(in_srgb,var(--warning-amber)_40%,white)] bg-[color-mix(in_srgb,var(--warning-amber)_10%,white)] text-[var(--text-primary)]';
const NOTICE_ERROR =
  'border-[color-mix(in_srgb,var(--error-red)_40%,white)] bg-[color-mix(in_srgb,var(--error-red)_8%,white)] text-[var(--text-primary)]';

const getNoticeTone = (status: NoticeStatus): string => {
  switch (status) {
    case 'BLOCKED':
      return NOTICE_WARNING;
    case 'FAILED':
      return NOTICE_ERROR;
    case 'CANCELLED':
    case 'DEFERRED':
    case 'incomplete':
      return NOTICE_NEUTRAL;
    default:
      return NOTICE_BASE;
  }
};

const getInitials = (value: string | null): string => {
  if (value === null) return '?';

  const initials = value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return initials.length > 0 ? initials : '?';
};

interface ContrastColumnProps {
  label: string;
  value: string | null;
  /** Highlights the documented fact side without relying on color alone. */
  fact?: boolean;
}

const ContrastColumn: React.FC<ContrastColumnProps> = ({ label, value, fact = false }) => {
  if (value === null) return null;

  return (
    <div
      className={cn(
        'min-w-0 rounded-[8px] border p-2.5',
        fact
          ? 'border-[color-mix(in_srgb,var(--success-green)_32%,white)] bg-[color-mix(in_srgb,var(--success-green)_7%,white)]'
          : 'border-[var(--divider)] bg-white',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-helper)]">
        {label}
      </p>
      <p className="mt-1 break-words text-[12px] font-semibold leading-[1.45] text-[var(--text-secondary)]">
        {value}
      </p>
    </div>
  );
};

interface StatusNoticeProps {
  status: NoticeStatus;
  title: string;
  body: string;
}

const StatusNotice: React.FC<StatusNoticeProps> = ({ status, title, body }) => {
  const Icon = NOTICE_ICONS[status];

  return (
    <div
      role="note"
      data-notice={status}
      className={cn('flex min-w-0 gap-2 rounded-[10px] border p-3', getNoticeTone(status))}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="break-words text-[12px] font-bold">{title}</p>
        <p className="mt-0.5 break-words text-[11px] leading-relaxed">{body}</p>
      </div>
    </div>
  );
};

/**
 * Three-layer verification card (LIVE-027).
 *
 * Layer 1 — conclusion and the contradiction / true-vs-distorted component;
 * Layer 2 — demonstrated mechanisms (never intent);
 * Layer 3 — EvidenceDisclosure with sources, limitations and revision state.
 *
 * Non-completed states render an operational notice and never expose a verdict.
 */
const VerificationCard: React.FC<VerificationCardProps> = ({
  verification,
  defaultOpen = false,
  onSelect,
  className,
}) => {
  const { t } = useI18n();
  const speakerMappings = useFactCheckStore((state) => state.speakerMappings);

  const definitive = isDefinitive(verification);
  const verdict = getDisplayVerdict(verification);
  const quote = deriveWhatSaid(verification);
  const whatFound = deriveWhatFound(verification);
  const contradiction = deriveContradiction(verification);
  const supportedAspects = getSupportedAspects(verification);
  const limitations = getLimitations(verification);
  const speaker = getSpeakerLabel(verification, speakerMappings);
  const timestamp = formatTimestamp(verification.timestampMs?.start);

  const noticeStatus: NoticeStatus =
    verification.status === 'COMPLETED' ? 'incomplete' : verification.status;
  const notice = t.liveCard.notices[noticeStatus];

  const handleCardClick = (event: React.MouseEvent<HTMLElement>) => {
    if (onSelect === undefined) return;

    const target = event.target;
    // Controls inside the card handle their own activation.
    if (
      target instanceof HTMLElement &&
      target.closest('a, button, input, select, textarea') !== null
    ) {
      return;
    }

    onSelect(verification.id);
  };

  return (
    <article
      className={cn(
        'min-w-0 overflow-hidden rounded-[14px] border border-[var(--divider)] bg-white shadow-[0_2px_12px_rgba(30,21,38,0.04)] transition-colors focus-within:border-[var(--border-hover-purple)]',
        onSelect !== undefined && 'cursor-pointer',
        className,
      )}
      onClick={handleCardClick}
      data-verification-id={verification.id}
      data-status={verification.status}
      data-verdict={verdict ?? undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-[8px] border border-[var(--divider)] bg-[var(--bg-purple-light)] text-[10px] font-bold text-[var(--purple-medium)]"
          >
            {getInitials(speaker)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[12px] font-semibold text-[var(--text-secondary)]">
              {speaker ?? t.liveCard.unknownSpeaker}
            </span>
            {!verification.transcriptConfirmed && (
              <span className={cn('text-[10px] font-medium', WARNING_TEXT)}>
                {t.liveCard.transcriptUnconfirmed}
              </span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock aria-hidden="true" className="size-3 shrink-0" />
            <span aria-hidden="true">{timestamp}</span>
            <span className="sr-only">
              {interpolate(t.liveCard.card.timestampAriaLabel, { timestamp })}
            </span>
          </span>
          <span>
            {interpolate(t.liveCard.card.revision, {
              revision: verification.revision,
            })}
          </span>
          {!definitive && <VerdictBadge verification={verification} />}
          {onSelect !== undefined && (
            <button
              type="button"
              onClick={() => onSelect(verification.id)}
              className={cn(
                'font-semibold text-[var(--purple-link)] underline-offset-2 hover:underline',
                FOCUS_RING,
              )}
            >
              {t.liveCard.card.select}
            </button>
          )}
        </div>
      </header>

      {quote !== null && (
        <blockquote className="mt-2 break-words px-4 font-[var(--font-merriweather)] text-[15px] leading-[1.55] text-[var(--text-active)]">
          <span className="sr-only">{t.liveCard.card.quoteAriaLabel}: </span>
          {'“'}
          {quote}
          {'”'}
        </blockquote>
      )}

      <div className="space-y-2 px-4 pb-3 pt-3">
        {definitive ? (
          <div
            role="group"
            aria-label={t.liveCard.sections.conclusion}
            className="rounded-[11px] border border-[var(--divider)] bg-[#f8f7fa] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge verification={verification} />
            </div>
            <p className="mt-2 break-words text-[13px] font-semibold leading-[1.48] text-[var(--text-primary)]">
              {verification.conclusion}
            </p>
          </div>
        ) : (
          <StatusNotice
            status={noticeStatus}
            title={notice.title}
            body={notice.body}
          />
        )}

        {definitive && verdict === 'FALSE' && contradiction !== null && (
          <div className="rounded-[8px] border border-l-[3px] border-[var(--divider)] border-l-[var(--purple-button)] bg-[#f9f7fc] p-3">
            <p className={SECTION_LABEL}>
              {t.liveCard.sections.contradiction}
            </p>
            <p className="mt-1.5 break-words text-[12px] leading-[1.62] text-[var(--text-primary)]">
              {contradiction}
            </p>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <ContrastColumn label={t.liveCard.sections.whatSaid} value={quote} />
              <ContrastColumn
                label={t.liveCard.sections.whatFound}
                value={whatFound}
                fact
              />
            </div>
          </div>
        )}

        {definitive && verdict === 'MISLEADING' && (
          <div className="rounded-[8px] border border-[var(--divider)] bg-[#f9f7fc] p-3">
            <p className={SECTION_LABEL}>
              {t.liveCard.sections.trueComponent}
            </p>
            {supportedAspects.length > 0 ? (
              <ul className="mt-1.5 grid gap-1">
                {supportedAspects.map((aspect, index) => (
                  <li
                    key={`${index}-${aspect}`}
                    className="break-words text-[12px] leading-[1.6] text-[var(--text-primary)]"
                  >
                    {aspect}
                  </li>
                ))}
              </ul>
            ) : (
              whatFound !== null && (
                <p className="mt-1.5 break-words text-[12px] leading-[1.6] text-[var(--text-primary)]">
                  {whatFound}
                </p>
              )
            )}

            <p className={cn(SECTION_LABEL, 'mt-2.5')}>
              {t.liveCard.sections.distortion}
            </p>
            <p className="mt-1 break-words text-[12px] leading-[1.6] text-[var(--text-primary)]">
              {verification.conclusion}
            </p>
          </div>
        )}

        {definitive && verdict === 'SUPPORTED' && supportedAspects.length > 0 && (
          <div className="rounded-[8px] border border-[color-mix(in_srgb,var(--success-green)_30%,white)] bg-[color-mix(in_srgb,var(--success-green)_7%,white)] p-3">
            <p className={SECTION_LABEL}>
              {t.liveCard.sections.supportedAspects}
            </p>
            <ul className="mt-1.5 grid gap-1">
              {supportedAspects.map((aspect, index) => (
                <li
                  key={`${index}-${aspect}`}
                  className="break-words text-[12px] leading-[1.6] text-[var(--text-primary)]"
                >
                  {aspect}
                </li>
              ))}
            </ul>
          </div>
        )}

        {definitive && verdict === 'INCONCLUSIVE' && (
          <div className="rounded-[8px] border border-[var(--divider)] bg-[var(--bg-overlay)] p-3">
            <p className={SECTION_LABEL}>
              {t.liveCard.sections.missing}
            </p>
            {limitations.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {limitations.map((limitation, index) => (
                  <li
                    key={`${index}-${limitation}`}
                    className="break-words text-[12px] leading-[1.6] text-[var(--text-primary)]"
                  >
                    {limitation}
                  </li>
                ))}
              </ul>
            ) : (
              whatFound !== null && (
                <p className="mt-1.5 break-words text-[12px] leading-[1.6] text-[var(--text-primary)]">
                  {whatFound}
                </p>
              )
            )}
          </div>
        )}

        {definitive && verification.mechanisms.length > 0 && (
          <div role="group" aria-label={t.liveCard.sections.mechanism}>
            <p className={cn(SECTION_LABEL, 'flex items-start gap-1.5')}>
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{t.liveCard.sections.mechanism}</span>
            </p>
            <ul className="mt-1.5 grid gap-2">
              {verification.mechanisms.map((mechanism, index) => {
                const linkedEvidence = getMechanismEvidence(verification, mechanism);
                const mechanismLabel =
                  t.liveCard.mechanisms[mechanism.code] ?? getMechanismLabel(mechanism.code);

                return (
                  <li
                    key={`${mechanism.code}-${index}`}
                    className="flex min-w-0 gap-2 rounded-[8px] border border-[var(--divider)] bg-white p-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-5 shrink-0 place-items-center rounded-[7px] bg-[var(--bg-purple-light)] text-[11px] font-bold text-[var(--purple-medium)]"
                    >
                      !
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-[11px] font-bold text-[var(--text-title)]">
                        {mechanismLabel}
                      </p>
                      <p className="mt-0.5 break-words text-[12px] leading-[1.5] text-[var(--text-secondary)]">
                        {mechanism.explanation}
                      </p>
                      {linkedEvidence.length > 0 && (
                        <div className="mt-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-helper)]">
                            {t.liveCard.mechanismEvidenceLabel}
                          </p>
                          <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                            {linkedEvidence.map((item) => (
                              <li key={item.evidence.id} className="min-w-0">
                                <a
                                  href={item.source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={cn(
                                    'break-words text-[10px] font-semibold text-[var(--purple-link)] hover:underline',
                                    FOCUS_RING,
                                  )}
                                >
                                  {item.source.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[10px] leading-snug text-[var(--text-muted)]">
              {t.liveCard.sections.mechanismHint}
            </p>
          </div>
        )}
      </div>

      <EvidenceDisclosure verification={verification} defaultOpen={defaultOpen} />
    </article>
  );
};

export default VerificationCard;
