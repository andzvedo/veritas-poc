"use client";

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { liveServerErrorKey } from '@/lib/live/liveUiState';

interface LiveSessionErrorBannerProps {
  className?: string;
}

/**
 * Actionable explanation for a server live-session ERROR (e.g. no
 * transcriber configured). Replaces the generic "Erro na Verificação" and the
 * silent stream of audio gaps the user used to see.
 */
const LiveSessionErrorBanner: React.FC<LiveSessionErrorBannerProps> = ({
  className,
}) => {
  const { t } = useI18n();
  const liveSessionState = useFactCheckStore((s) => s.liveSessionState);
  const liveErrorCode = useFactCheckStore((s) => s.liveErrorCode);
  const detail = useFactCheckStore((s) => s.error);

  if (liveSessionState !== 'ERROR') return null;

  const messages = t.live.serverErrors;
  const message = messages[liveServerErrorKey(liveErrorCode)];

  return (
    <div
      role="alert"
      data-slot="live-session-error"
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-4 text-sm text-[#7f1d1d]',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-[#b91c1c]" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-[#b91c1c]">{messages.title}</p>
        <p className="leading-relaxed">{message}</p>
        {detail && (
          <p className="break-words text-xs text-[#991b1b]/80">
            <span className="font-medium">{messages.detailLabel}:</span>{' '}
            {detail}
          </p>
        )}
      </div>
    </div>
  );
};

export default LiveSessionErrorBanner;
