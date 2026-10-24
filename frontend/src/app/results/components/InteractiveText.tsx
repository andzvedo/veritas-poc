"use client";

import React, { useMemo } from 'react';
import type { ResultData } from '@/lib/types/results';
import { TextHighlight } from '@/app/shared/components/TextHighlight';
import { findClaimHighlights } from '@/lib/verification/claimHighlights';

interface InteractiveTextProps {
  text: string;
  results: ResultData[];
  onClaimClick?: (claimId: string) => void;
  selectedClaimId?: string;
  className?: string;
}

const InteractiveText: React.FC<InteractiveTextProps> = ({
  text,
  results,
  onClaimClick,
  selectedClaimId,
  className,
}) => {
  const claims = useMemo(() => findClaimHighlights(text, results), [text, results]);

  return (
    <TextHighlight
      text={text}
      claims={claims}
      selectedClaimId={selectedClaimId}
      onClaimClick={onClaimClick}
      className={className}
    />
  );
};

export default InteractiveText;
