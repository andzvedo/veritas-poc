    "use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import ProcessedTextPanel from './ProcessedTextPanel';
import ResultsPanel from './ResultsPanel';
import type { ResultData } from '@/lib/types/results';
import { factCheckService } from '@/lib/services/factCheckService';
import Header from '@/app/shared/components/Header';
import { ConfirmationDialog } from '@/app/shared/components/ConfirmationDialog';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { useApiKeys } from '@/lib/hooks/useApiKeys';
import { useI18n, interpolate } from '@/lib/i18n/I18nContext';
import { factCheckResultToResultData } from '@/lib/verification/textModeResult';

interface ResultsPageProps {
  text?: string;
  onNewVerification?: () => void;
  className?: string;
  demoMode?: boolean; // Modo demo para Storybook - não tenta conectar ao backend
}

const ResultsPage: React.FC<ResultsPageProps> = ({
  text,
  onNewVerification,
  className,
  demoMode = false
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
  const hasVerificationResults = verificationState.results.length > 0;
  const shouldConfirmSettingsNavigation =
    isVerificationInProgress || hasCompletedVerification || hasVerificationResults;

  const handleConfigurationsClick = () => {
    if (shouldConfirmSettingsNavigation) {
      setShowSettingsConfirmModal(true);
      return;
    }

    factCheckService.reset();
    router.push('/setup');
  };

  // Converte FactCheckResult do backend para ResultData do componente.
  // Preferência: verification.verdict (LIVE-016/017); nunca assume "verified"
  // só porque a flag MISLEADING está ausente.
  const convertToResultData = useCallback(
    (result: Parameters<typeof factCheckResultToResultData>[0]): ResultData =>
      factCheckResultToResultData(result),
    [],
  );

  // Converte o estado de verificação para o estado do painel de resultados
  const getResultsPanelStatus = useCallback((): 'loading' | 'partial' | 'complete' | 'error' => {
    const hasResults = verificationState.results.length > 0;

    // Se já existem resultados, mostramos o estado "partial" enquanto o backend
    // ainda está processando, e "complete" quando finalizar.
    if (hasResults) {
      if (verificationState.status === 'error' || verificationState.status === 'interrupted') {
        return 'error';
      }
      return verificationState.status === 'finished' ? 'complete' : 'partial';
    }

    // Sem resultados ainda: loading, a menos que haja erro/interrupção
    if (verificationState.status === 'error' || verificationState.status === 'interrupted') {
      return 'error';
    }

    // Se está finalizado mas sem resultados, retorna complete (o header vai mostrar o estado correto)
    if (verificationState.status === 'finished') {
      return 'complete';
    }

    return 'loading';
  }, [verificationState.status, verificationState.results.length]);

  // Converte os resultados do backend para o formato do componente
  const convertedResults = verificationState.results.map(convertToResultData);

  console.log('📊 Resultados convertidos:', {
    count: convertedResults.length,
    results: convertedResults
  });

  // Função para gerar o texto completo formatado com todos os resultados
  const generateFormattedText = useCallback(() => {
    const originalText = verificationState.processedText || text || '';
    const results = convertedResults;

    if (!originalText) return '';

    let formattedText = '';

    // Adiciona o texto original
    formattedText += `${t.results.export.verifiedText}:\n`;
    formattedText += '==================\n\n';
    formattedText += originalText;
    formattedText += '\n\n';

    // Se não há resultados, adiciona informação
    if (results.length === 0) {
      formattedText += `${t.results.export.verificationResults}:\n`;
      formattedText += '=========================\n\n';
      formattedText += `${t.results.export.noResultsFound}.\n`;
      return formattedText;
    }

    // Adiciona os resultados da verificação
    formattedText += `${t.results.export.verificationResults}:\n`;
    formattedText += '=========================\n\n';

    results.forEach((result, index) => {
      formattedText += `${index + 1}. ${t.results.export.verifiedClaim}:\n`;
      formattedText += `${result.text}\n\n`;

      // Status da verificação
      // let statusText = '';
      // switch (result.status) {
      //   case 'verified':
      //     statusText = '✅ VERIFICADO';
      //     break;
      //   case 'unverified':
      //     statusText = '❌ NÃO VERIFICADO';
      //     break;
      //   case 'pending':
      //     statusText = '⏳ PENDENTE';
      //     break;
      //   default:
      //     statusText = '❓ INDETERMINADO';
      // }

      // formattedText += `Status: ${statusText}\n`;
      // formattedText += `Confiança: ${Math.round(result.confidence * 100)}%\n\n`;

      // Análise/explicação
      if (result.explanation) {
        formattedText += `${t.results.export.analysis}:\n`;
        formattedText += `${result.explanation}\n\n`;
      }

      // Fontes
      if (result.sources && result.sources.length > 0) {
        formattedText += `${t.results.export.sources}:\n`;
        result.sources.forEach((source: string, sourceIndex: number) => {
          formattedText += `${sourceIndex + 1}. ${source}\n`;
        });
        formattedText += '\n';
      }

      // Separador entre resultados
      if (index < results.length - 1) {
        formattedText += '---\n\n';
      }
    });

    // Adiciona informações finais
    formattedText += '\n';
    formattedText += `${t.results.export.generatedBy}\n`;
    formattedText += `${t.results.export.date}: ${new Date().toLocaleDateString(locale === 'pt-BR' ? 'pt-BR' : 'en-US')}\n`;
    formattedText += interpolate(t.results.export.totalClaims, { count: results.length }) + '\n';

    return formattedText;
  }, [verificationState.processedText, text, convertedResults, t, locale]);

  const handleCopyPlainText = useCallback(async () => {
    try {
      const textToCopy = generateFormattedText();
      if (!textToCopy) return;

      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback para navegadores antigos
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

  // Inicializa a conexão com o backend
  useEffect(() => {
    if (isInitialized) return;

    // Modo demo: pula a conexão com backend
    if (demoMode) {
      console.log('🎭 Modo demo ativado - pulando conexão com backend');
      setIsInitialized(true);
      return;
    }

    const initializeConnection = async () => {
      try {
        console.log('🔌 Inicializando conexão com o backend...');

        // Testa a conexão
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

  // O estado já é sincronizado automaticamente via Zustand

  // Inicia a verificação automaticamente quando a página carrega
  useEffect(() => {
    if (!isInitialized) return;

    // Modo demo: não inicia verificação
    if (demoMode) {
      console.log('🎭 Modo demo - usando dados mock da store');
      return;
    }

    const startVerification = async () => {
      try {
        // Se já há resultados ou verificação em andamento, não inicia nova verificação
        const currentState = factCheckService.getState();
        if (currentState.results.length > 0 || currentState.status === 'processing' || currentState.status === 'connecting') {
          console.log('📊 Usando estado existente:', currentState.status, 'com', currentState.results.length, 'resultados');
          return;
        }

        // Verifica se há texto processado disponível
        const serviceText = factCheckService.getProcessedText();
        if (!serviceText || serviceText.trim() === '') {
          console.log('⚠️ Nenhum texto processado disponível, aguardando...');
          return;
        }

        console.log('🚀 Iniciando verificação de fatos...');
        console.log('📝 Texto:', serviceText);

        // Garante envio das API keys ao backend
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

    // Inicia a verificação imediatamente
    startVerification();
  }, [isInitialized, text, apiKeys, demoMode]);

  const handleNewVerification = () => {
    // Sempre mostrar modal de confirmação
    setShowNewTextModal(true);
  };

  const handleConfirmNewText = () => {
    console.log('✅ Modal confirmado - executando ação');
    setShowNewTextModal(false);
    if (onNewVerification) {
      onNewVerification();
    } else {
      // Fallback: redirecionar para home
      window.location.href = '/';
    }
  };

  const handleCancelNewText = () => {
    // Apenas fecha o modal, não faz nada mais
    console.log('🚫 Modal cancelado - fechando modal');
    setShowNewTextModal(false);
  };

  // Handlers para sincronização bidirecional
  const handleClaimClick = useCallback((claimId: string) => {
    console.log('🎯 CLAIM clicado:', claimId);
    setSelectedClaimId(claimId);

    // Scroll para o resultado correspondente
    const resultElement = document.getElementById(`result-${claimId}`);
    if (resultElement) {
      resultElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, []);

  const handleResultClick = useCallback((resultId: string) => {
    console.log('📊 Resultado clicado:', resultId);
    setSelectedClaimId(resultId);

    // Scroll para o CLAIM correspondente no texto
    const claimElement = document.getElementById(`claim-${resultId}`);
    if (claimElement) {
      claimElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, []);

  return (
    <div className={cn('min-h-screen', className)} style={{ backgroundColor: 'var(--veritas-results-background)' }}>
      {/* Header (mesmo layout do /verification) */}
      <div className="max-w-[1440px] mx-auto px-20">
        <Header
          showSettings={true}
          onSettingsClick={handleConfigurationsClick}
        />
      </div>

      <div className="max-w-[1440px] mx-auto px-[80px] sm:px-4 lg:px-26 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 h-[calc(100vh-7rem)] gap-20">
          {/* Coluna Esquerda - Texto Processado */}
          <div className="rounded-lg">
            <ProcessedTextPanel
              text={verificationState.processedText || text || ''}
              results={convertedResults}
              onNewVerification={handleNewVerification}
              onClaimClick={handleClaimClick}
              selectedClaimId={selectedClaimId}
            />
          </div>

          {/* Coluna Direita - Resultados */}
          <div>
            <ResultsPanel
              status={getResultsPanelStatus()}
              results={convertedResults}
              onCopyPlainText={handleCopyPlainText}
              onCancel={() => setShowCancelVerificationModal(true)}
              onResultClick={handleResultClick}
              selectedResultId={selectedClaimId}
            />
          </div>
        </div>
      </div>

      {/* Modal de Confirmação para ir às Configurações */}
      <ConfirmationDialog
        isOpen={showSettingsConfirmModal}
        onClose={() => setShowSettingsConfirmModal(false)}
        onCancel={() => setShowSettingsConfirmModal(false)}
        variant="cancel-verification"
        description="Tem certeza de que deseja ir para configurações? Se continuar, tudo o que foi feito até agora será perdido."
        confirmText="Ir para Configurações"
        onConfirm={() => {
          factCheckService.reset();
          setShowSettingsConfirmModal(false);
          router.push('/setup');
        }}
      />

      {/* Modal de Confirmação para Novo Texto */}
      <ConfirmationDialog
        isOpen={showNewTextModal}
        onClose={() => setShowNewTextModal(false)}
        onCancel={handleCancelNewText}
        variant="new-text"
        onConfirm={handleConfirmNewText}
      />

      {/* Modal de Confirmação para Cancelar Verificação */}
      <ConfirmationDialog
        isOpen={showCancelVerificationModal}
        onClose={() => setShowCancelVerificationModal(false)}
        onCancel={() => setShowCancelVerificationModal(false)}
        variant="cancel-verification"
        onConfirm={() => {
          // Limpa estado local e serviço, e volta para a home
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
