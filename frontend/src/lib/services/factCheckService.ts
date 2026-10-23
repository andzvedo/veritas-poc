import { io, Socket } from 'socket.io-client';
import CryptoJS from 'crypto-js';
import { API_CONFIG } from '../config/api';
import {
  FactCheckRequest,
  FactCheckResult,
  UpdateStatus,
  ChunkCount,
  VerificationState,
  VerificationStatus,
  ClientToServerEvents,
  ServerToClientEvents
} from '../types/api';
import { factCheckStore } from '../store/factCheckStore';

type RequestOptions = Partial<Omit<FactCheckRequest, 'fingerprint' | 'apiKeys'>> & {
  apiKeys?: { google?: string; tavily?: string };
};

export class FactCheckService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

  constructor(private backendUrl: string = API_CONFIG.BACKEND_URL) {}

  /**
   * Gera um fingerprint MD5 único para a sessão
   */
  private generateFingerprint(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    const input = `${timestamp}-${random}`;
    return CryptoJS.MD5(input).toString();
  }

  /**
   * Conecta ao WebSocket do backend
   */
  private async connect(): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = io(this.backendUrl, {
        transports: ['websocket', 'polling'], // Adicionar fallback para polling
        timeout: API_CONFIG.WEBSOCKET_TIMEOUT,
        forceNew: true, // Forçar nova conexão
        reconnection: true, // Habilitar reconexão automática
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
      });

      this.socket.on('connect', () => {
        console.log('✅ Conectado ao backend WebSocket');
        console.log('🔗 Socket ID:', this.socket?.id);
        console.log('🌐 URL:', this.backendUrl);
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ Erro ao conectar com o backend:', error);
        console.error('🌐 URL tentada:', this.backendUrl);
        console.error('📊 Detalhes do erro:', {
          message: error.message,
          type: (error as Error & { type?: string }).type || 'unknown',
          description: (error as Error & { description?: string }).description || 'No description available'
        });
        factCheckStore.setState({ 
          status: 'error', 
          error: `Erro ao conectar com o servidor: ${error.message}` 
        });
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Desconectado do backend:', reason);
      });

      // Eventos específicos da verificação de fatos
      this.socket.on('FACT_CHECK_RESULT', (result: FactCheckResult) => {
        console.log('Resultado recebido:', result);
        
        // Double check: verifica estrutura do resultado (legado + verification opcional).
        if (!result.data || !result.data.extractedClaim || typeof result.data.reasoningConfidence !== 'number' || !result.meta) {
          console.warn('⚠️ API pode ter mudado: estrutura do FACT_CHECK_RESULT diferente do esperado');
        } else if (result.data.verification === undefined && result.data.resultVersion === undefined) {
          console.warn('ℹ️ FACT_CHECK_RESULT sem verification estruturada (payload legado)');
        }
        
        const currentState = factCheckStore.getState();
        factCheckStore.setState({
          results: [...currentState.results, result]
        });
      });

      this.socket.on('UPDATE_STATUS', (status: UpdateStatus) => {
        console.log('Status atualizado:', status);
        
        let newStatus: VerificationStatus = 'idle';
        switch (status.data.status) {
          case 'PROCESSING':
            newStatus = 'processing';
            break;
          case 'FINISHED':
            newStatus = 'finished';
            break;
          case 'EXCEPTION':
            newStatus = 'error';
            break;
          case 'INTERRUPTED':
            newStatus = 'interrupted';
            break;
        }

        factCheckStore.setState({
          status: newStatus,
          message: status.data.message
        });
      });

      this.socket.on('CHUNK_COUNT', (chunkCount: ChunkCount) => {
        console.log('Contagem de chunks:', chunkCount);
        console.log(`📦 Texto dividido em ${chunkCount.data.chunkCount} chunks para processamento`);
        factCheckStore.setState({
          chunkCount: chunkCount.data.chunkCount
        });
      });
    });
  }

  /**
   * Registra um listener para mudanças de estado usando Zustand
   */
  public onStateChange(listener: (state: VerificationState) => void): () => void {
    // Chama o listener imediatamente com o estado atual
    listener(factCheckStore.getState());
    
    // Subscreve às mudanças da store
    return factCheckStore.subscribe((state) => {
      listener(state);
    });
  }

  /**
   * Testa a conectividade com o backend
   */
  public async testConnection(): Promise<boolean> {
    try {
      console.log('🧪 Testando conectividade com o backend...');
      console.log('🌐 URL:', this.backendUrl);
      
      // Testa HTTP primeiro
      const response = await fetch(`${this.backendUrl}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const healthData = await response.json();
      console.log('✅ Health check OK:', healthData);
      
      // Double check: verifica se a API retorna o formato esperado
      if (!healthData.status) {
        console.warn('⚠️ API pode ter mudado: campo "status" não encontrado na resposta');
      }
      
      // Testa WebSocket
      await this.connect();
      console.log('✅ WebSocket conectado');
      
      return true;
    } catch (error) {
      console.error('❌ Teste de conectividade falhou:', error);
      return false;
    }
  }

  /**
   * Envia uma requisição de verificação de fatos
   */
  public async requestFactCheck(
    content: string, 
    options: RequestOptions = {}
  ): Promise<string> {
    if (!content.trim()) {
      throw new Error('Conteúdo não pode estar vazio');
    }

    try {
      // Garante conexão com o backend (auto-conectável)
      if (!this.isConnected()) {
        await this.connect();
      }

      // Gera novo fingerprint
      const fingerprint = this.generateFingerprint();

      // Limpa resultados anteriores e atualiza estado
      factCheckStore.setState({
        status: 'connecting',
        results: [],
        chunkCount: undefined,
        error: undefined,
        message: 'Conectando ao servidor...',
        processedText: content,
        fingerprint
      });

      // Prepara a requisição
      const request: FactCheckRequest = {
        fingerprint,
        researchThreshold: options.researchThreshold ?? API_CONFIG.DEFAULT_RESEARCH_THRESHOLD,
        apiKeys: {
          google: options.apiKeys?.google ?? '',
          tavily: options.apiKeys?.tavily ?? ''
        }
      };

      // Envia a requisição (garantir socket inicializado)
      if (!this.socket) {
        throw new Error('Conexão com o backend não está disponível.');
      }
      this.socket.emit('REQUEST_FACT_CHECK', content, request);

      return fingerprint;
    } catch (error) {
      console.error('Erro ao enviar requisição de verificação:', error);
      factCheckStore.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      throw error;
    }
  }

  /**
   * Obtém o estado atual da verificação
   */
  public getState(): VerificationState {
    return factCheckStore.getState();
  }

  /**
   * Obtém o texto processado
   */
  public getProcessedText(): string {
    return factCheckStore.getState().processedText;
  }

  /**
   * Limpa o estado atual
   */
  public reset(): void {
    factCheckStore.setState({
      status: 'idle',
      results: [],
      chunkCount: undefined,
      error: undefined,
      message: undefined,
      processedText: '',
      fingerprint: null
    });
  }

  /**
   * Desconecta do WebSocket
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    factCheckStore.setState({ status: 'idle' });
  }

  /**
   * Verifica se está conectado
   */
  public isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

// Instância singleton do serviço
export const factCheckService = new FactCheckService();
