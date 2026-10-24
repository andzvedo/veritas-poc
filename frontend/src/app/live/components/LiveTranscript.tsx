"use client";

import React, { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { factCheckService } from '@/lib/services/factCheckService';
import { buildTranscriptBlocks, type TranscriptLine } from '@/lib/live/transcriptView';
import LiveTranscriptView from './LiveTranscriptView';

interface LiveTranscriptProps {
  className?: string;
  selectedClaimId?: string;
  onNavigateToClaim?: (claimId: string, verificationId?: string) => void;
}

/**
 * Progressive transcript panel (LIVE-026).
 * Shows only what was said (speaker + speech, claims highlighted inline).
 * Gating/quality info lives next to the verification cards
 * (see LiveGatingNotice); corrections stay available via a discreet icon.
 */
const LiveTranscript: React.FC<LiveTranscriptProps> = ({
  className,
  selectedClaimId,
  onNavigateToClaim,
}) => {
  const { t } = useI18n();
  const segments = useFactCheckStore((s) => s.segments);
  const claims = useFactCheckStore((s) => s.claims);
  const mappings = useFactCheckStore((s) => s.speakerMappings);
  const conflicts = useFactCheckStore((s) => s.segmentConflicts);
  const sessionId = useFactCheckStore((s) => s.sessionId);
  const liveGaps = useFactCheckStore((s) => s.liveGaps);
  const verifications = useFactCheckStore((s) => s.verifications);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const blocks = useMemo(
    () => buildTranscriptBlocks(segments, claims, mappings),
    [segments, claims, mappings],
  );

  const handleStartEdit = (line: TranscriptLine) => {
    setEditingId(line.segmentId);
    setDraft(line.text);
  };

  const handleSubmitCorrection = (line: TranscriptLine) => {
    if (!sessionId || draft.trim().length === 0) return;
    factCheckService.correctTranscript({
      sessionId,
      segmentId: line.segmentId,
      expectedRevision: line.revision,
      text: draft.trim(),
    });
    setEditingId(null);
  };

  const verificationIdForClaim = (claimId: string): string | undefined => {
    const pending = `claim-pending-${claimId}`;
    const match =
      verifications.find((item) => item.claimId === claimId) ??
      verifications.find((item) => item.id === pending);
    return match?.id;
  };

  const selectedTranscriptClaimId = useMemo(() => {
    if (!selectedClaimId) return undefined;
    const verification = verifications.find((item) => item.id === selectedClaimId);
    if (verification?.claimId) return verification.claimId;
    return selectedClaimId.startsWith('claim-pending-')
      ? selectedClaimId.slice('claim-pending-'.length)
      : undefined;
  }, [selectedClaimId, verifications]);

  return (
    <LiveTranscriptView
      className={className}
      blocks={blocks}
      strings={t.live.transcript}
      cancelLabel={t.common.cancel}
      gapCount={liveGaps.length}
      conflictSegmentIds={conflicts}
      canCorrect={Boolean(sessionId)}
      editingSegmentId={editingId}
      draft={draft}
      selectedClaimId={selectedTranscriptClaimId}
      onDraftChange={setDraft}
      onStartEdit={handleStartEdit}
      onSubmitEdit={handleSubmitCorrection}
      onCancelEdit={() => setEditingId(null)}
      onClaimClick={(claimId) =>
        onNavigateToClaim?.(claimId, verificationIdForClaim(claimId))
      }
    />
  );
};

export default LiveTranscript;
