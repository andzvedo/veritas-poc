"use client";

import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TranslationKeys } from '@/lib/i18n/types';
import {
  hasGatingInfo,
  type TranscriptGatingSummary,
} from '@/lib/live/transcriptView';

type GatingStrings = TranslationKeys['live']['gating'];

export interface LiveGatingNoticeProps {
  summary: TranscriptGatingSummary;
  strings: GatingStrings;
  className?: string;
}

/**
 * Verification-side summary of what was NOT checked and why (unknown
 * authorship, uncertain numbers/negations). Moved out of the transcript so the
 * transcript only shows what was said (LIVE-007/026/040).
 */
const LiveGatingNotice: React.FC<LiveGatingNoticeProps> = ({
  summary,
  strings,
  className,
}) => {
  if (!hasGatingInfo(summary)) return null;

  const otherBlocked = Math.max(0, summary.blocked - summary.unknownAuthorship);
  const items: string[] = [];
  const push = (template: string, count: number) => {
    if (count > 0) items.push(template.replace('{{count}}', String(count)));
  };
  push(strings.unknownAuthorship, summary.unknownAuthorship);
  push(strings.blocked, otherBlocked);
  push(strings.uncertainNumber, summary.uncertainNumber);
  push(strings.uncertainNegation, summary.uncertainNegation);
  push(strings.otherUncertain, summary.otherUncertain);

  return (
    <div
      role="note"
      data-slot="live-gating-notice"
      className={cn(
        'w-full rounded-xl border border-[#ece8f2] bg-[#faf9fc] px-3 py-2.5 text-xs text-[#6e678a]',
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-semibold text-[#4e4558] mb-1">
        <Info className="size-3.5 text-[#8a5cda]" aria-hidden />
        {strings.title}
      </p>
      <ul className="space-y-0.5 pl-5 list-disc marker:text-[#c9bfd6]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-[#9a8fa6]">{strings.hint}</p>
    </div>
  );
};

export default LiveGatingNotice;
