"use client";

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import Header from '@/app/shared/components/Header';
import ResultsPanel from '@/app/results/components/ResultsPanel';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { selectDisplayVerifications } from '@/lib/store/verificationSync';
import { useI18n } from '@/lib/i18n/I18nContext';
import { liveSessionController } from '@/lib/live/liveSessionController';
import LiveAudioControls from './LiveAudioControls';
import LiveTranscript from './LiveTranscript';

interface LiveWorkspaceProps {
  className?: string;
}

/**
 * Live accompaniment layout: controls + transcript + progressive cards.
 */
const LiveWorkspace: React.FC<LiveWorkspaceProps> = ({ className }) => {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mobileTab, setMobileTab] = useState<'transcript' | 'results'>(
    'transcript',
  );
  const [selectedClaimId, setSelectedClaimId] = useState<string | undefined>();

  const verifications = useFactCheckStore((s) => s.verifications);
  const results = useFactCheckStore((s) => s.results);
  const sessionId = useFactCheckStore((s) => s.sessionId);
  const claims = useFactCheckStore((s) => s.claims);
  const status = useFactCheckStore((s) => s.status);
  const liveSessionState = useFactCheckStore((s) => s.liveSessionState);

  const displayVerifications = selectDisplayVerifications(
    verifications,
    results,
    sessionId,
  );

  const panelStatus: 'loading' | 'partial' | 'complete' | 'error' =
    status === 'error'
      ? 'error'
      : status === 'finished' || liveSessionState === 'ENDED'
        ? 'complete'
        : displayVerifications.length > 0
          ? 'partial'
          : 'loading';

  const handlePause = useCallback(async () => {
    setBusy(true);
    try {
      await liveSessionController.pause();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleResume = useCallback(async () => {
    setBusy(true);
    try {
      await liveSessionController.resume();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      await liveSessionController.stop();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleNavigateToClaim = useCallback(
    (claimId: string, verificationId?: string) => {
      const targetId = verificationId ?? `claim-pending-${claimId}`;
      setSelectedClaimId(targetId);
      setMobileTab('results');
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          document
            .getElementById(`result-${targetId}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    },
    [],
  );

  return (
    <div
      className={cn(
        'relative min-h-screen w-full bg-gradient-to-b from-[#f5f5f5] to-[#eaeaea]',
        className,
      )}
    >
      <div className="absolute top-0 left-0 right-0 z-30">
        <div className="max-w-[1350px] mx-auto px-4 sm:px-6 lg:px-8">
          <Header
            showSettings={true}
            onSettingsClick={() => router.push('/setup')}
          />
        </div>
      </div>

      <main className="relative z-20 max-w-[1350px] mx-auto px-4 sm:px-6 lg:px-8 pt-[84px] pb-28">
        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#755a97] mb-2">
              {t.live.workspace.eyebrow}
            </p>
            <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#381257] mb-2">
              {t.live.workspace.title}
            </h1>
            <p className="text-sm text-[#766d83] max-w-xl leading-relaxed">
              {t.live.workspace.intro}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#7c7189]">
              <span className="rounded-full border border-[#e4ddec] bg-white px-3 py-2">
                {t.live.setup.sourceMic}
              </span>
              <span className="rounded-full border border-[#e4ddec] bg-white px-3 py-2 font-variant-numeric tabular-nums">
                {claims.length === 1
                  ? t.live.workspace.claimCountOne.replace('{{count}}', '1')
                  : t.live.workspace.claimCount.replace(
                      '{{count}}',
                      String(claims.length),
                    )}
              </span>
            </div>
          </div>

          <LiveAudioControls
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            starting={busy}
            className="hidden sm:flex"
          />
        </header>

        <div className="grid sm:hidden grid-cols-2 gap-1.5 p-1.5 mb-3 rounded-[11px] bg-[#ebe7f0]">
          <button
            type="button"
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-semibold',
              mobileTab === 'transcript'
                ? 'bg-white text-[#351397] shadow-sm'
                : 'text-[#6e678a]',
            )}
            onClick={() => setMobileTab('transcript')}
          >
            {t.live.transcript.title}
          </button>
          <button
            type="button"
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-semibold',
              mobileTab === 'results'
                ? 'bg-white text-[#351397] shadow-sm'
                : 'text-[#6e678a]',
            )}
            onClick={() => setMobileTab('results')}
          >
            {t.live.workspace.resultsTitle}
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <div
            className={cn(
              mobileTab === 'transcript' ? 'block' : 'hidden',
              'sm:block',
            )}
          >
            <LiveTranscript onNavigateToClaim={handleNavigateToClaim} />
          </div>
          <div
            className={cn(
              mobileTab === 'results' ? 'block' : 'hidden',
              'sm:block',
            )}
          >
            <ResultsPanel
              status={panelStatus}
              verifications={displayVerifications}
              selectedResultId={selectedClaimId}
              onResultClick={setSelectedClaimId}
              className="rounded-[19px] border border-[#dfdbe5] bg-white shadow-[0_8px_36px_rgba(31,14,57,0.04)]"
            />
          </div>
        </div>
      </main>

      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#e4ddec] bg-white/95 backdrop-blur px-3 py-2.5">
        <LiveAudioControls
          variant="dock"
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          starting={busy}
        />
      </div>
    </div>
  );
};

export default LiveWorkspace;
