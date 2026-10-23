"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Verification } from '@veritas/shared';
import { cn } from '@/lib/utils';
import ProcessedTextPanel from './ProcessedTextPanel';
import ResultsPanel from './ResultsPanel';
import type { ResultData } from '@/lib/types/results';
import { factCheckService } from '@/lib/services/factCheckService';
import Header from '@/app/shared/components/Header';
import { ConfirmationDialog } from '@/app/shared/components/ConfirmationDialog';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { selectDisplayVerifications } from '@/lib/store/verificationSync';
import { useApiKeys } from '@/lib/hooks/useApiKeys';
import { useI18n, interpolate } from '@/lib/i18n/I18nContext';
import { getDisplayVerdict } from '@/lib/verification/presentation';
import { verdictToOutcome } from '@/lib/verification/textModeResult';

interface ResultsPageProps {
  text?: string;
  onNewVerification?: () => void;
  className?: string;
  demoMode?: boolean;
}

const verificationToResultData = (verification: Verification): ResultData => {
  const verdict = getDisplayVerdict(verification);

  return {
    id: verification.id,
    text: verification.normalizedClaim || verification.originalQuote,
    // Confidence percentages are not shown (LIVE-027: nenhum percentual de verdade).
    confidence: 0,
    status: verdict !== null ? verdictToOutcome(verdict) : 'pending',
    sources: verification.sources.map((source) => source.url),
    explanation: verification.conclusion,
  };
};

const ResultsPage: React.FC<ResultsPageProps> = ({
  text,
  onNewVerification,
  className,
  demoMode = false,
}) => {
  const { t, locale } = useI18n();
  const router = useRouter();
  const verificationState = useFactCheckStore();
  const { apiKeys } = useApiKeys();
  const [isInitialized, setIsInitialized] = useState(false);
  const [showSettingsConfirmModal, setShowSettingsConfirmModal] = useState(false);
  const [showNewTextModal, setShowNewTextModal] = useState(false);
  const [showCancelVerificationModal, setShowCancelVerificationModal] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | undefined>();

  const isVerificationInProgress =
    verificationState.status === 'processing' || verificationState.status === 'connecting';
  const hasCompletedVerification = verificationState.status === 'finished';
  const displayVerifications = selectDisplayVerifications(
    verificationState.verifications,
    verificationState.results,
    verificationState.sessionId,
  );
  const hasVerificationResults = displayVerifications.length > 0;
  const shouldConfirmSettingsNavigation =
    isVerificationInProgress || hasCompletedVerification || hasVerificationResults;

  const highlightResults = displayVerifications.map(verificationToResultData);

  const handleConfigurationsClick = () => {
    if (shouldConfirmSettingsNavigation) {
      setShowSettingsConfirmModal(true);
      return;
    }

    factCheckService.reset();
    router.push('/setup');
  };

  const getResultsPanelStatus = useCallback((): 'loading' | 'partial' | 'complete' | 'error' => {
    const hasResults = displayVerifications.length > 0;

    if (hasResults) {
      if (verificationState.status === 'error' || verificationState.status === 'interrupted') {
        return 'error';
      }
      return verificationState.status === 'finished' ? 'complete' : 'partial';
    }

    if (verificationState.status === 'error' || verificationState.status === 'interrupted') {
      return 'error';
    }

    if (verificationState.status === 'finished') {
      return 'complete';
    }

    return 'loading';
  }, [verificationState.status, displayVerifications.length]);

  const generateFormattedText = useCallback(() => {
    const originalText = verificationState.processedText || text || '';
    const results = highlightResults;

    if (!originalText) return '';

    let formattedText = '';

    formattedText += `${t.results.export.verifiedText}:\n`;
    formattedText += '==================\n\n';
    formattedText += originalText;
    formattedText += '\n\n';

    if (results.length === 0) {
      formattedText += `${t.results.export.verificationResults}:\n`;
      formattedText += '=========================\n\n';
      formattedText += `${t.results.export.noResultsFound}.\n`;
      return formattedText;
    }

    formattedText += `${t.results.export.verificationResults}:\n`;
    formattedText += '=========================\n\n';

    results.forEach((result, index) => {
      formattedText += `${index + 1}. ${t.results.export.verifiedClaim}:\n`;
      formattedText += `${result.text}\n\n`;

      if (result.explanation) {
        formattedText += `${t.results.export.analysis}:\n`;
        formattedText += `${result.explanation}\n\n`;
      }

      if (result.sources && result.sources.length > 0) {
        formattedText += `${t.results.export.sources}:\n`;
        result.sources.forEach((source: string, sourceIndex: number) => {
          formattedText += `${sourceIndex + 1}. ${source}\n`;
        });
        formattedText += '\n';
      }

      if (index < results.length - 1) {
        formattedText += '---\n\n';
      }
    });

    formattedText += '\n';
    formattedText += `${t.results.export.generatedBy}\n`;
    formattedText += `${t.results.export.date}: ${new Date().toLocaleDateString(locale === 'pt-BR' ? 'pt-BR' : 'en-US')}\n`;
    formattedText += interpolate(t.results.export.totalClaims, { count: results.length }) + '\n';

    return formattedText;
  }, [verificationState.processedText, text, highlightResults, t, locale]);

  const handleCopyPlainText = useCallback(async () => {
    try {
      const textToCopy = generateFormattedText();
      if (!textToCopy) return;

      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {
      console.error('Falha ao copiar texto:', e);
    }
  }, [generateFormattedText]);

  useEffect(() => {
    if (isInitialized) return;

    if (demoMode) {
      console.log('🎭 Modo demo ativado - pulando conexão com backend');
      setIsInitialized(true);
      return;
    }

    const initializeConnection = async () => {
      try {
        console.log('🔌 Inicializando conexão com o backend...');

        const isConnected = await factCheckService.testConnection();
        if (!isConnected) {
          console.error('❌ Falha ao conectar com o backend');
          return;
        }

        console.log('✅ Conexão com o backend estabelecida');
        setIsInitialized(true);
      } catch (error) {
        console.error('❌ Erro ao inicializar conexão:', error);
      }
    };

    void initializeConnection();
  }, [isInitialized, demoMode, text]);

  // Auto-start text verification only when there is no existing progressive work.
  useEffect(() => {
    if (!isInitialized) return;

    if (demoMode) {
      console.log('🎭 Modo demo - usando dados mock da store');
      return;
    }

    const startVerification = async () => {
      try {
        const currentState = factCheckService.getState();
        if (
          currentState.results.length > 0 ||
          currentState.verifications.length > 0 ||
          currentState.status === 'processing' ||
          currentState.status === 'connecting' ||
          currentState.status === 'finished'
        ) {
          console.log(
            '📊 Usando estado existente:',
            currentState.status,
            'com',
            currentState.verifications.length || currentState.results.length,
            'resultados',
          );
          return;
        }

        const serviceText = factCheckService.getProcessedText();
        if (!serviceText || serviceText.trim() === '') {
          console.log('⚠️ Nenhum texto processado disponível, aguardando...');
          return;
        }

        console.log('🚀 Iniciando verificação de fatos...');
        console.log('📝 Texto:', serviceText);

        if (!apiKeys?.google || !apiKeys?.tavily) {
          console.warn('⚠️ API keys ausentes; abortando verificação automática na ResultsPage');
          return;
        }

        const fingerprint = await factCheckService.requestFactCheck(serviceText, {
          researchThreshold: 0.5,
          apiKeys: {
            google: apiKeys.google,
            tavily: apiKeys.tavily,
          },
        });

        console.log('🔑 Fingerprint gerado:', fingerprint);
      } catch (error) {
        console.error('❌ Erro ao iniciar verificação:', error);
      }
    };

    void startVerification();
  }, [isInitialized, text, apiKeys, demoMode]);

  const handleNewVerification = () => {
    setShowNewTextModal(true);
  };

  const handleConfirmNewText = () => {
    console.log('✅ Modal confirmado - executando ação');
    setShowNewTextModal(false);
    if (onNewVerification) {
      onNewVerification();
    } else {
      window.location.href = '/';
    }
  };

  const handleCancelNewText = () => {
    console.log('🚫 Modal cancelado - fechando modal');
    setShowNewTextModal(false);
  };

  const handleClaimClick = useCallback((claimId: string) => {
    console.log('🎯 CLAIM clicado:', claimId);
    setSelectedClaimId(claimId);

    const resultElement = document.getElementById(`result-${claimId}`);
    if (resultElement) {
      resultElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, []);

  const handleResultClick = useCallback((resultId: string) => {
    console.log('📊 Resultado clicado:', resultId);
    setSelectedClaimId(resultId);

    const claimElement = document.getElementById(`claim-${resultId}`);
    if (claimElement) {
      claimElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, []);

  return (
    <div
      className={cn('min-h-screen', className)}
      style={{ backgroundColor: 'var(--veritas-results-background)' }}
    >
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-20">
        <Header showSettings={true} onSettingsClick={handleConfigurationsClick} />
      </div>

      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-20">
        <div className="grid h-auto grid-cols-1 gap-8 lg:h-[calc(100vh-7rem)] lg:grid-cols-2 lg:gap-20">
          <div className="rounded-lg">
            <ProcessedTextPanel
              text={verificationState.processedText || text || ''}
              results={highlightResults}
              onNewVerification={handleNewVerification}
              onClaimClick={handleClaimClick}
              selectedClaimId={selectedClaimId}
            />
          </div>

          <div className="min-w-0">
            <ResultsPanel
              status={getResultsPanelStatus()}
              verifications={displayVerifications}
              onCopyPlainText={handleCopyPlainText}
              onCancel={() => setShowCancelVerificationModal(true)}
              onResultClick={handleResultClick}
              selectedResultId={selectedClaimId}
            />
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={showSettingsConfirmModal}
        onClose={() => setShowSettingsConfirmModal(false)}
        onCancel={() => setShowSettingsConfirmModal(false)}
        variant="cancel-verification"
        description={t.confirmationDialog.goToSettings.description}
        confirmText={t.confirmationDialog.goToSettings.confirm}
        onConfirm={() => {
          factCheckService.reset();
          setShowSettingsConfirmModal(false);
          router.push('/setup');
        }}
      />

      <ConfirmationDialog
        isOpen={showNewTextModal}
        onClose={() => setShowNewTextModal(false)}
        onCancel={handleCancelNewText}
        variant="new-text"
        onConfirm={handleConfirmNewText}
      />

      <ConfirmationDialog
        isOpen={showCancelVerificationModal}
        onClose={() => setShowCancelVerificationModal(false)}
        onCancel={() => setShowCancelVerificationModal(false)}
        variant="cancel-verification"
        onConfirm={() => {
          factCheckService.reset();
          setShowCancelVerificationModal(false);
          if (typeof window !== 'undefined') {
            window.location.href = '/';
          }
        }}
      />
    </div>
  );
};

export default ResultsPage;
