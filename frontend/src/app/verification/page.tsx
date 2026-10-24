"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/app/shared/components/Header';
import ComingSoonBanner from '@/app/shared/components/ComingSoonBanner';
import LiveCapturePanel from './LiveCapturePanel';
import VerificationTextArea from '@/app/shared/components/VerificationTextArea';
import { factCheckService } from '@/lib/services/factCheckService';
import { useApiKeys } from '@/lib/hooks/useApiKeys';
import { useI18n } from '@/lib/i18n/I18nContext';

// Constante para o texto de exemplo (conforme memória do PR)
const EXAMPLE_FACT_CHECK_TEXT = "As vacinas contra COVID-19 foram desenvolvidas em tempo recorde em 2020. O Brasil iniciou sua campanha de vacinação em janeiro de 2021. Estudos mostram que as vacinas reduziram significativamente as hospitalizações e mortes pela doença.";

/**
 * Verification Page - Página de verificação de fatos
 * Design v0.2: Node 650:16293 (Empty State) e 650:16447 (Entered State)
 *
 * Fluxo: First Access → Setup → **Verification** → Results
 *
 * Especificações:
 * - Background: Gradiente #f5f5f5 → #eaeaea
 * - Top-bar: Com botão "Configurations" que volta para Setup
 * - Título: "Cole o texto para verificar", 28px
 * - Coming Soon Banner
 * - Text Area com character counter
 */
export default function VerificationPage() {
  const router = useRouter();
  const { apiKeys } = useApiKeys();
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

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

      // Testa conectividade primeiro
      const isConnected = await factCheckService.testConnection();

      if (!isConnected) {
        alert(t.errors.connectionFailed);
        setIsVerifying(false);
        return;
      }

      // Envia requisição para o backend com as API keys
      await factCheckService.requestFactCheck(text, {
        apiKeys: {
          google: apiKeys?.google,
          tavily: apiKeys?.tavily
        }
      });

      // Aguarda um pouco para garantir que o texto foi processado
      await new Promise(resolve => setTimeout(resolve, 100));

      // Redireciona para a página de resultados
      router.push('/results');

    } catch (error) {
      console.error('❌ Erro ao iniciar verificação:', error);
      alert(error instanceof Error ? error.message : t.errors.internalError);
      setIsVerifying(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-gradient-to-b from-[var(--bg-gradient-start)] to-[var(--bg-gradient-end)]">
      {/* Background overlay - z-1 */}
      <div className="absolute inset-0 opacity-70 z-[1]">
        <div
          className="absolute inset-0 bg-gradient-to-b from-transparent from-[62.687%] to-[var(--bg-overlay)] to-[97.25%]"
        />
      </div>

      {/* Top-bar - z-30 */}
      <div className="absolute top-0 left-0 right-0 z-30">
        <div className="max-w-[1440px] mx-auto px-20">
          <Header
            showSettings={true}
            onSettingsClick={handleConfigurationsClick}
          />
        </div>
      </div>

      {/* Verification Content - z-20 */}
      <div className="relative z-20 flex items-start justify-center min-h-screen px-4 pt-[84px] pb-12">
        <div className="flex w-full max-w-[900px] flex-col items-center pt-[48px] gap-8">

          <LiveCapturePanel apiKeys={{ google: apiKeys?.google, tavily: apiKeys?.tavily }} />

          {/* Header com Título e Coming Soon */}
          <div className="flex w-full flex-col items-center gap-4">
            <h1
              className="font-[var(--font-inter)] font-medium text-[28px] leading-[40px] tracking-[0.28px] text-center min-w-full w-[min-content]"
              style={{ color: 'var(--text-title)' }}
            >
              {t.verification.title}
            </h1>
            <ComingSoonBanner />
          </div>

          {/* Text Area Component */}
          <div className="w-full max-w-[570px]">
          <VerificationTextArea
            value={text}
            onChange={setText}
            onUseExample={handleUseExample}
            onVerify={handleVerify}
          />
          </div>

        </div>
      </div>
    </div>
  );
}
