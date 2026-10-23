"use client";

import React from 'react';
import type { Verification } from '@veritas/shared';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { ResultsHeader, VerificationStatus } from './ResultsHeader';
import { Button } from '@/app/shared/components/ui/button';
import { useI18n } from '@/lib/i18n/I18nContext';
import VerificationCard from './VerificationCard';

interface ResultsPanelProps {
  status: 'loading' | 'partial' | 'complete' | 'error';
  verifications: Verification[];
  className?: string;
  onCancel?: () => void;
  onRetry?: () => void;
  onCopyPlainText?: () => void;
  onResultClick?: (resultId: string) => void;
  selectedResultId?: string;
}

const ResultsPanel: React.FC<ResultsPanelProps> = ({
  status,
  verifications,
  className,
  onCancel,
  onRetry,
  onCopyPlainText,
  onResultClick,
  selectedResultId,
}) => {
  const { t } = useI18n();

  const getVerificationStatus = (): VerificationStatus => {
    switch (status) {
      case 'loading':
      case 'partial':
        return 'verifying';
      case 'complete':
        if (verifications.length === 0) {
          return 'complete-no-results';
        }
        return 'done';
      case 'error':
        return 'error';
      default: {
        const _exhaustive: never = status;
        void _exhaustive;
        return 'verifying';
      }
    }
  };

  const selectedIndex = verifications.findIndex((item) => item.id === selectedResultId);
  const canGoPrev = verifications.length > 0 && selectedIndex > 0;
  const canGoNext =
    verifications.length > 0 &&
    selectedIndex >= 0 &&
    selectedIndex < verifications.length - 1;

  const prevDisabledTooltip =
    selectedIndex === -1
      ? t.results.navigation.noneSelected
      : selectedIndex === 0
        ? t.results.navigation.firstClaim
        : undefined;

  const nextDisabledTooltip =
    selectedIndex === -1
      ? t.results.navigation.noneSelected
      : selectedIndex === verifications.length - 1
        ? t.results.navigation.lastClaim
        : undefined;

  const handlePrev = () => {
    if (canGoPrev) onResultClick?.(verifications[selectedIndex - 1].id);
  };

  const handleNext = () => {
    if (canGoNext) onResultClick?.(verifications[selectedIndex + 1].id);
  };

  const claimsCountLabel =
    verifications.length === 1
      ? `${verifications.length} ${t.results.claimFound}`
      : `${verifications.length} ${t.results.claimsFound}`;

  const renderResults = () => {
    if (status === 'loading') {
      return (
        <div className="w-full space-y-4">
          <div className="relative box-border flex w-full shrink-0 flex-col items-start gap-2 rounded-2xl border border-solid border-[var(--purple-primary)] py-4 pl-3 pr-4">
            <div className="relative flex w-full shrink-0 items-start gap-2">
              <div className="relative size-4 shrink-0">
                <div className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--skeleton-bg-light)]" />
                <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--skeleton-bg-medium)]" />
              </div>
              <div className="relative flex min-h-px min-w-px flex-[1_0_0] shrink-0 flex-col items-start gap-3">
                <div className="relative h-4 w-full shrink-0 animate-[shimmer_10s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[var(--skeleton-bg-light)] via-[var(--skeleton-bg-medium)] to-[var(--skeleton-bg-light)] bg-[length:200px_100%]" />
                <div className="relative h-4 w-72 shrink-0 animate-[shimmer_10s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[var(--skeleton-bg-light)] via-[var(--skeleton-bg-medium)] to-[var(--skeleton-bg-light)] bg-[length:200px_100%]" />
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="relative box-border flex shrink-0 items-center gap-2 rounded-2xl bg-[var(--text-error-bg)] p-6">
            <div className="relative size-12 shrink-0 overflow-clip">
              <AlertCircle className="size-12 text-[var(--text-error)]" />
            </div>
          </div>
          <div className="relative flex shrink-0 flex-col justify-center overflow-hidden overflow-ellipsis whitespace-nowrap font-['Inter'] text-sm font-normal not-italic leading-[0] text-[var(--text-active)]">
            <p className="overflow-hidden overflow-ellipsis leading-6">
              {t.results.messages.error}
            </p>
          </div>
        </div>
      );
    }

    if (verifications.length === 0) {
      if (status === 'complete') {
        return (
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="relative box-border flex shrink-0 items-center gap-2 rounded-2xl bg-[var(--bg-purple-light)] p-6">
              <div className="relative size-12 shrink-0 overflow-clip">
                <CheckCircle2 className="size-12 text-[var(--purple-button)]" />
              </div>
            </div>
            <div className="relative flex shrink-0 flex-col justify-center overflow-hidden overflow-ellipsis whitespace-nowrap font-['Inter'] text-sm font-normal not-italic leading-[0] text-[var(--text-active)]">
              <p className="overflow-hidden overflow-ellipsis leading-6">
                {t.results.messages.noResults}
              </p>
            </div>
          </div>
        );
      }

      return (
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <CheckCircle2 className="mb-4 size-12 text-muted-foreground" />
          <p className="text-muted-foreground">{t.results.messages.processing}</p>
        </div>
      );
    }

    return (
      <div className="w-full space-y-4">
        {verifications.map((verification) => (
          <div
            key={verification.id}
            id={`result-${verification.id}`}
            className={cn(
              'w-full transition-shadow',
              selectedResultId === verification.id &&
                'rounded-[14px] ring-2 ring-[var(--purple-button)] ring-offset-2',
            )}
          >
            <VerificationCard
              verification={verification}
              onSelect={onResultClick}
              className="w-full"
            />
          </div>
        ))}

        {status === 'partial' && (
          <div className="relative box-border flex w-full shrink-0 flex-col items-start gap-2 rounded-2xl border border-solid border-[var(--purple-primary)] py-4 pl-3 pr-4">
            <div className="relative flex w-full shrink-0 items-start gap-2">
              <div className="relative size-4 shrink-0">
                <div className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--skeleton-bg-light)]" />
                <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--skeleton-bg-medium)]" />
              </div>
              <div className="relative flex min-h-px min-w-px flex-[1_0_0] shrink-0 flex-col items-start gap-3">
                <div className="relative h-4 w-full shrink-0 animate-[shimmer_10s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[var(--skeleton-bg-light)] via-[var(--skeleton-bg-medium)] to-[var(--skeleton-bg-light)] bg-[length:200px_100%]" />
                <div className="relative h-4 w-72 shrink-0 animate-[shimmer_10s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[var(--skeleton-bg-light)] via-[var(--skeleton-bg-medium)] to-[var(--skeleton-bg-light)] bg-[length:200px_100%]" />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const showFooter =
    (status === 'complete' || status === 'partial') && verifications.length > 0;

  return (
    <div
      className={cn(
        'inline-flex w-full flex-col items-start justify-start',
        'max-h-[calc(100vh-7rem)]',
        className,
      )}
    >
      <div className="relative box-border flex w-full shrink-0 flex-col items-start gap-4 pt-4">
        <div className="relative flex w-full shrink-0 items-start">
          <ResultsHeader
            status={getVerificationStatus()}
            onCancel={onCancel}
            onRetry={onRetry}
            onCopy={onCopyPlainText}
          />
        </div>
        <div className="relative h-0 w-full shrink-0">
          <div className="absolute bottom-0 left-0 right-0 top-[-1px] border-t border-[var(--helper-border)]" />
        </div>
      </div>

      <div
        className={cn(
          'relative box-border flex w-full shrink-0 flex-col items-center gap-4 px-2 py-4',
          'flex-1 overflow-y-auto',
          (status === 'error' || (status === 'complete' && verifications.length === 0)) &&
            'justify-center',
        )}
      >
        {renderResults()}
      </div>

      {showFooter && (
        <div className="relative box-border flex w-full shrink-0 flex-col items-start gap-4 px-0 pb-6 pt-0">
          <div className="relative h-0 w-full shrink-0">
            <div className="absolute bottom-0 left-0 right-0 top-[-1px] border-t border-[var(--helper-border)]" />
          </div>
          <div className="relative flex w-full shrink-0 items-start justify-between">
            <div className="relative flex shrink-0 items-center gap-2 self-stretch">
              <div className="relative flex shrink-0 flex-col justify-center whitespace-nowrap font-['Inter'] text-sm font-medium not-italic leading-[0] text-slate-900 opacity-50">
                <p className="leading-5">{claimsCountLabel}</p>
              </div>
            </div>
            <div className="relative flex shrink-0 items-center gap-2">
              <Button
                variant="link"
                size="sm"
                disabled={!canGoPrev}
                disabledTooltip={prevDisabledTooltip}
                onClick={handlePrev}
                className="px-1 py-0.5"
              >
                <ChevronLeft className="size-4" />
                {t.common.previous}
              </Button>
              <Button
                variant="link"
                size="sm"
                disabled={!canGoNext}
                disabledTooltip={nextDisabledTooltip}
                onClick={handleNext}
                className="px-1 py-0.5"
              >
                {t.common.next}
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsPanel;
