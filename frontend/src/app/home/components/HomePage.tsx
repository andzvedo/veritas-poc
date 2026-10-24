"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import Header from '@/app/shared/components/Header';
import HeroSection from './HeroSection';
import VerificationForm from './VerificationForm';
import HomePageToast from './HomePageToast';
import ModeToggle from '@/app/live/components/ModeToggle';
import LiveSetupPanel, {
  type LiveStartRequest,
} from '@/app/live/components/LiveSetupPanel';
import LiveAudioControls from '@/app/live/components/LiveAudioControls';
import { factCheckService } from '@/lib/services/factCheckService';
import { useFactCheckStore } from '@/lib/store/factCheckStore';
import { useApiKeys } from '@/lib/hooks/useApiKeys';
import ApiSetupPage from '@/app/shared/components/ApiSetupPage';
import { Button } from '@/app/shared/components/ui/button';
import { useI18n } from '@/lib/i18n/I18nContext';
import { liveSessionController } from '@/lib/live/liveSessionController';
import type { LiveInputMode } from '@/lib/live/liveUiState';

// Constante para o texto de exemplo
const EXAMPLE_FACT_CHECK_TEXT = "As vacinas contra COVID-19 foram desenvolvidas em tempo recorde em 2020. O Brasil iniciou sua campanha de vacinação em janeiro de 2021. Estudos mostram que as vacinas reduziram significativamente as hospitalizações e mortes pela doença.";

interface HomePageProps {
  className?: string;
  router?: {
    push: (url: string) => void;
  };
}

const HomePage: React.FC<HomePageProps> = ({ className, router: propRouter }) => {
  const { t } = useI18n();
  const nextRouter = useRouter();
  const router = propRouter || nextRouter;
  const { apiKeys, isLoading, saveApiKeys, hasApiKeys } = useApiKeys();
  const [textValue, setTextValue] = useState<string>("");
  const [inputMode, setInputMode] = useState<LiveInputMode>('text');
  const [startingLive, setStartingLive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const verificationState = useFactCheckStore();
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    isVisible: boolean;
  }>({
    type: 'info',
    message: '',
    isVisible: false
  });

  // Todos os hooks devem vir antes de qualquer return condicional
  const handleUseExample = useCallback(() => {
    setTextValue(EXAMPLE_FACT_CHECK_TEXT);
  }, []);

  // Escuta mudanças no estado da verificação (modo Texto apenas)
  useEffect(() => {
    if (inputMode !== 'text') return;

    if (verificationState.status === 'finished') {
      setToast({
        type: 'success',
        message: 'Verificação concluída! Redirecionando para os resultados...',
        isVisible: true
      });

      setTimeout(() => {
        setToast(prev => ({ ...prev, isVisible: false }));
        router.push('/results');
      }, 2000);
    } else if (verificationState.status === 'error') {
      setToast({
        type: 'error',
        message: verificationState.error || 'Erro na verificação. Tente novamente.',
        isVisible: true
      });

      setTimeout(() => {
        setToast(prev => ({ ...prev, isVisible: false }));
      }, 5000);
    } else if (verificationState.status === 'interrupted') {
      setToast({
        type: 'error',
        message: 'Verificação interrompida. Tente novamente.',
        isVisible: true
      });

      setTimeout(() => {
        setToast(prev => ({ ...prev, isVisible: false }));
      }, 5000);
    }
  }, [verificationState.status, verificationState.error, router, inputMode]);

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
      setToast({
        type: 'error',
        message:
          error instanceof Error ? error.message : t.errors.internalError,
        isVisible: true,
      });
      setTimeout(() => {
        setToast((prev) => ({ ...prev, isVisible: false }));
      }, 6000);
    } finally {
      setStartingLive(false);
    }
  }, [apiKeys?.google, apiKeys?.tavily, router, t.errors.internalError, t.live.micErrors]);

  // Mantém a conexão entre páginas para não interromper o stream de resultados
  // (não desconectar no unmount)

  const handleCheckFacts = useCallback(async () => {
    if (!textValue.trim()) {
      setToast({
        type: 'error',
        message: 'Por favor, insira um texto para verificar.',
        isVisible: true
      });
      return;
    }

    try {
      // Limpa estado anterior
      factCheckService.reset();

      // Testa conectividade primeiro
      console.log('🧪 Testando conectividade antes de enviar requisição...');
      const isConnected = await factCheckService.testConnection();

      if (!isConnected) {
        setToast({
          type: 'error',
          message: t.errors.connectionFailed,
          isVisible: true
        });
        return;
      }

      // Envia requisição para o backend com as API keys
      const fingerprint = await factCheckService.requestFactCheck(textValue, {
        apiKeys: {
          google: apiKeys?.google,
          tavily: apiKeys?.tavily
        }
      });

      console.log('✅ Verificação iniciada com fingerprint:', fingerprint);

      // Aguarda um pouco para garantir que o texto foi processado
      await new Promise(resolve => setTimeout(resolve, 100));

      // Redireciona direto para a página de resultados
      router.push('/results');

    } catch (error) {
      console.error('❌ Erro ao iniciar verificação:', error);
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : t.errors.internalError,
        isVisible: true
      });

      setTimeout(() => {
        setToast(prev => ({ ...prev, isVisible: false }));
      }, 5000);
    }
  }, [textValue, router, apiKeys?.google, apiKeys?.tavily, t.errors.connectionFailed, t.errors.internalError]);

  const handleTextChange = useCallback((text: string) => {
    setTextValue(text);
  }, []);

  const handleCloseToast = useCallback(() => {
    setToast(prev => ({ ...prev, isVisible: false }));
  }, []);

  // Mostra loading enquanto carrega as keys
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#f5f5f5] to-[#eaeaea]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#22c55e] mx-auto mb-4"></div>
          <p className="text-gray-600">{t.common.loading}...</p>
        </div>
      </div>
    );
  }

  // Mostra setup se não tiver API keys
  if (!hasApiKeys) {
    return (
      <ApiSetupPage
        onComplete={saveApiKeys}
        initialKeys={apiKeys || undefined}
      />
    );
  }

  return (
    <div className={cn(
      "bg-gradient-to-b from-[#f5f5f5] to-[#eaeaea] relative w-full min-h-screen overflow-hidden",
      className
    )}>
      {/* Barra Superior */}
      <div className="absolute top-0 left-0 right-0 z-30">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8">
          <Header
            showSettings={true}
            onSettingsClick={() => setShowSettings(true)}
          />
        </div>
      </div>

      {/* Modal de Configurações */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative max-w-4xl w-full mx-4">
            <ApiSetupPage
              onComplete={(keys) => {
                saveApiKeys(keys);
                setShowSettings(false);
                setToast({
                  type: 'success',
                  message: 'API keys atualizadas com sucesso!',
                  isVisible: true
                });
                setTimeout(() => {
                  setToast(prev => ({ ...prev, isVisible: false }));
                }, 3000);
              }}
              initialKeys={apiKeys || undefined}
            />
            <div className="absolute top-4 right-4">
              <Button
                variant="link"
                size="icon"
                onClick={() => setShowSettings(false)}
                className="bg-white rounded-lg shadow-lg"
              >
                <X className="w-6 h-6" />
              </Button>
            </div>
          </div>
        </div>
      )}


      {/* Container Principal de Conteúdo */}
      <div className="relative z-20 flex items-center justify-center min-h-screen px-4 sm:px-6 lg:px-8 py-20">
        <div className="w-full max-w-[1280px] mx-auto">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">

            {/* Seção Hero - Lado Esquerdo */}
            <div className="order-1 lg:order-1">
              <HeroSection className="max-w-[629px] mx-auto lg:mx-0" />
            </div>

            {/* Entrada Texto / Live - Lado Direito */}
            <div className="order-2 lg:order-2">
              <div className="max-w-[571px] mx-auto lg:mx-0 flex flex-col gap-4">
                <ModeToggle
                  mode={inputMode}
                  onModeChange={setInputMode}
                  disabled={startingLive || verificationState.status === 'processing' || verificationState.status === 'connecting'}
                />

                {inputMode === 'text' ? (
                  <VerificationForm
                    onUseExample={handleUseExample}
                    onCheckFacts={handleCheckFacts}
                    onTextChange={handleTextChange}
                    value={textValue}
                  />
                ) : (
                  <>
                    <LiveSetupPanel
                      onStart={handleStartLive}
                      starting={startingLive}
                    />
                    <LiveAudioControls className="mt-1" />
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Ajustes específicos para Mobile/Tablet */}
      <div className="lg:hidden">
        {/* Espaçamento adicional para mobile */}
        <div className="h-16" />
      </div>

      {/* Notificação Toast */}
      <HomePageToast
        type={toast.type}
        message={toast.message}
        isVisible={toast.isVisible}
        onClose={handleCloseToast}
      />
    </div>
  );
};

export default HomePage;
