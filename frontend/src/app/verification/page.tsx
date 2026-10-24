"use client";

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/app/shared/components/Header';
import ComingSoonBanner from '@/app/shared/components/ComingSoonBanner';
import VerificationTextArea from '@/app/shared/components/VerificationTextArea';
import ModeToggle from '@/app/live/components/ModeToggle';
import LiveSetupPanel, {
  type LiveStartRequest,
} from '@/app/live/components/LiveSetupPanel';
import LiveAudioControls from '@/app/live/components/LiveAudioControls';
import { factCheckService } from '@/lib/services/factCheckService';
import { useApiKeys } from '@/lib/hooks/useApiKeys';
import { useI18n } from '@/lib/i18n/I18nContext';
import { liveSessionController } from '@/lib/live/liveSessionController';
import type { LiveInputMode } from '@/lib/live/liveUiState';

const EXAMPLE_FACT_CHECK_TEXT =
  'As vacinas contra COVID-19 foram desenvolvidas em tempo recorde em 2020. O Brasil iniciou sua campanha de vacinação em janeiro de 2021. Estudos mostram que as vacinas reduziram significativamente as hospitalizações e mortes pela doença.';

/**
 * Verification Page — Text mode + Live audio entry (LIVE-007 / LIVE-025).
 */
export default function VerificationPage() {
  const router = useRouter();
  const { apiKeys } = useApiKeys();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [inputMode, setInputMode] = useState<LiveInputMode>('text');
  const [startingLive, setStartingLive] = useState(false);

  const handleConfigurationsClick = () => {
    router.push('/setup');
  };

  const handleUseExample = () => {
    setText(EXAMPLE_FACT_CHECK_TEXT);
  };

  const handleVerify = async () => {
    if (!text.trim() || isVerifying) return;

    try {
      setIsVerifying(true);

      const isConnected = await factCheckService.testConnection();

      if (!isConnected) {
        alert(t.errors.connectionFailed);
        setIsVerifying(false);
        return;
      }

      await factCheckService.requestFactCheck(text, {
        apiKeys: {
          google: apiKeys?.google,
          tavily: apiKeys?.tavily,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      router.push('/results');
    } catch (error) {
      console.error('❌ Erro ao iniciar verificação:', error);
      alert(error instanceof Error ? error.message : t.errors.internalError);
      setIsVerifying(false);
    }
  };

  const handleStartLive = useCallback(async ({ deviceId }: LiveStartRequest) => {
    setStartingLive(true);
    try {
      await liveSessionController.start({
        apiKeys: {
          google: apiKeys?.google,
          tavily: apiKeys?.tavily,
        },
        deviceId: deviceId || undefined,
        micMessages: t.live.micErrors,
      });
      router.push('/live');
    } catch (error) {
      console.error('❌ Erro ao iniciar Live:', error);
      alert(error instanceof Error ? error.message : t.errors.internalError);
    } finally {
      setStartingLive(false);
    }
  }, [apiKeys?.google, apiKeys?.tavily, router, t.errors.internalError, t.live.micErrors]);

  return (
    <div className="relative min-h-screen w-full bg-gradient-to-b from-[var(--bg-gradient-start)] to-[var(--bg-gradient-end)]">
      <div className="absolute inset-0 opacity-70 z-[1]">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-[62.687%] to-[var(--bg-overlay)] to-[97.25%]" />
      </div>

      <div className="absolute top-0 left-0 right-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-20">
          <Header
            showSettings={true}
            onSettingsClick={handleConfigurationsClick}
          />
        </div>
      </div>

      <div className="relative z-20 flex items-start justify-center min-h-screen px-4 pt-[84px] pb-12">
        <div className="flex flex-col items-center w-full max-w-[570px] pt-[64px] gap-8">
          <div className="flex flex-col gap-4 items-center w-full">
            <h1
              className="font-[var(--font-inter)] font-medium text-[28px] leading-[40px] tracking-[0.28px] text-center w-full"
              style={{ color: 'var(--text-title)' }}
            >
              {inputMode === 'live' ? t.live.setup.title : t.verification.title}
            </h1>
            {inputMode === 'text' && <ComingSoonBanner />}
          </div>

          <ModeToggle
            mode={inputMode}
            onModeChange={setInputMode}
            disabled={isVerifying || startingLive}
          />

          {inputMode === 'text' ? (
            <VerificationTextArea
              value={text}
              onChange={setText}
              onUseExample={handleUseExample}
              onVerify={handleVerify}
            />
          ) : (
            <div className="w-full flex flex-col gap-3">
              <LiveSetupPanel onStart={handleStartLive} starting={startingLive} />
              <LiveAudioControls />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
