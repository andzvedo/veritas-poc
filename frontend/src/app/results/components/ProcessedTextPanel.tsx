"use client";

import React from 'react';
import { Button } from '@/app/shared/components/ui/button';
import { cn } from '@/lib/utils';
import { Plus, Type } from 'lucide-react';
import InteractiveText from './InteractiveText';
import type { ResultData } from '@/lib/types/results';
import ResultsSectionTitle from './ResultsSectionTitle';
import { useI18n } from '@/lib/i18n/I18nContext';

interface ProcessedTextPanelProps {
  text: string;
  results?: ResultData[];
  onNewVerification: () => void;
  onClaimClick?: (claimId: string) => void;
  selectedClaimId?: string;
  className?: string;
}

const ProcessedTextPanel: React.FC<ProcessedTextPanelProps> = ({
  text,
  results = [],
  onNewVerification,
  onClaimClick,
  selectedClaimId,
  className
}) => {
  const { t } = useI18n();

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="py-3 sm:py-4 border-b border-[#d6d8db] flex-shrink-0">
        <div className="content-stretch flex items-center justify-between relative shrink-0 w-full">
          <ResultsSectionTitle
            icon={<Type className="size-[24px] text-slate-900" />}
            text={t.results.processedText}
          />
          <Button
            onClick={onNewVerification}
            variant="filled"
            size="sm"
            className="flex items-center gap-2"
          >
            <Plus className="size-4" />
            {t.results.actions.new}
          </Button>
        </div>
      </div>

      {/* Text Content */}
      <div className="px-1 sm:px-2 flex-1 pb-4 overflow-y-auto flex flex-col justify-start max-h-[calc(100vh-180px)] sm:max-h-[calc(100vh-200px)]">
        <InteractiveText
          text={text}
          results={results}
          onClaimClick={onClaimClick}
          selectedClaimId={selectedClaimId}
          className={cn(
            "[font-family:var(--font-merriweather)]",
            "text-zinc-500 pt-4 pb-4 text-sm font-normal leading-7 tracking-tight"
          )}
        />
      </div>
    </div>
  );
};

export default ProcessedTextPanel;
