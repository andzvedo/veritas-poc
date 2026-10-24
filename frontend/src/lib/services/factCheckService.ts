import { io, Socket } from 'socket.io-client';
import CryptoJS from 'crypto-js';
import type {
  ClaimDetectedEvent,
  ClaimStatusUpdatedEvent,
  EventEnvelope,
  SessionSnapshotEvent,
  VerificationInvalidatedEvent,
  VerificationResultEvent,
  TranscriptSegment,
} from '@veritas/shared';
import { AudioChunker } from '../audio/audioStream';
import { startTabAudioCapture, type TabAudioCapture } from '../audio/tabCapture';
import { API_CONFIG } from '../config/api';
import {
  FactCheckRequest,
  FactCheckResult,
  UpdateStatus,
  ChunkCount,
  VerificationState,
  VerificationStatus,
  ClientToServerEvents,
  ServerToClientEvents,
} from '../types/api';
import { factCheckStore, useFactCheckStore } from '../store/factCheckStore';

type RequestOptions = Partial<Omit<FactCheckRequest, 'fingerprint' | 'apiKeys'>> & {
  apiKeys?: { google?: string; tavily?: string };
};

const pendingClaimId = (claimId: string) => `claim-pending-${claimId}`;

export class FactCheckService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private liveSessionId: string | null = null;
  private audioChunker: AudioChunker | null = null;
  private tabCapture: TabAudioCapture | null = null;
  private removeCaptureEndedListener: (() => void) | null = null;

  constructor(private backendUrl: string = API_CONFIG.BACKEND_URL) {}

  private generateFingerprint(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    const input = `${timestamp}-${random}`;
    return CryptoJS.MD5(input).toString();
  }

  /**
   * Applies a server envelope once: dedupe by eventId, ignore other sessions,
   * then advance the cursor. Returns false when the event must be skipped.
   */
  private acceptEnvelope(envelope: EventEnvelope): boolean {
    const store = useFactCheckStore.getState();
    if (!store.rememberEventId(envelope.eventId)) {
      return false;
    }
    if (
      store.sessionId !== null &&
      envelope.sessionId !== undefined &&
      envelope.sessionId !== store.sessionId
    ) {
      return false;
    }
    store.advanceCursor(envelope.eventSeq);
    return true;
  }

  private registerHandlers(
    socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  ): void {
    socket.on('FACT_CHECK_RESULT', (result: FactCheckResult) => {
      console.log('Resultado recebido:', result);

      if (
        !result.data ||
        !result.data.extractedClaim ||
        typeof result.data.reasoningConfidence !== 'number' ||
        !result.meta
      ) {
        console.warn(
          '⚠️ API pode ter mudado: estrutura do FACT_CHECK_RESULT diferente do esperado',
        );
      } else if (
        result.data.verification === undefined &&
        result.data.resultVersion === undefined
      ) {
        console.warn(
          'ℹ️ FACT_CHECK_RESULT sem verification estruturada (payload legado)',
        );
      }

      useFactCheckStore.getState().upsertFactCheckResult(result);
    });

    socket.on('UPDATE_STATUS', (status: UpdateStatus) => {
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
        default: {
          const _exhaustive: never = status.data.status;
          console.warn('Status desconhecido:', _exhaustive);
          newStatus = 'idle';
          break;
        }
      }

      factCheckStore.setState({
        status: newStatus,
        message: status.data.message,
      });
    });

    socket.on('CHUNK_COUNT', (chunkCount: ChunkCount) => {
      console.log('Contagem de chunks:', chunkCount);
      console.log(
        `📦 Texto dividido em ${chunkCount.data.chunkCount} chunks para processamento`,
      );
      factCheckStore.setState({
        chunkCount: chunkCount.data.chunkCount,
      });
    });

    socket.on('LIVE_SESSION_STARTED', (event) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      factCheckStore.setState({
        sessionId: event.data.sessionId,
        status: 'processing',
        message: event.data.state,
      });
    });

    const applyTranscript = (event: { envelope: EventEnvelope; data: { segment: TranscriptSegment } }) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      useFactCheckStore.getState().upsertTranscriptSegment(event.data.segment);
    };
    socket.on('TRANSCRIPT_PARTIAL', applyTranscript);
    socket.on('TRANSCRIPT_FINAL', applyTranscript);
    socket.on('TRANSCRIPT_REVISED', applyTranscript);

    socket.on('SPEAKER_MAPPING_UPDATED', (event) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      useFactCheckStore.getState().setSpeakerMappings(event.data.mappings, event.data.revision);
    });

    socket.on('AUDIO_CHUNK_ACK', (event) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      if (event.data.sessionId === this.liveSessionId) {
        if (event.data.accepted) this.audioChunker?.ack(event.data.chunkSeq);
        else this.audioChunker?.fail(event.data.chunkSeq);
      }
    });

    socket.on('LIVE_SESSION_STATE', (event) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      const state = event.data.state;
      // ENDING = draining research — not the same as captura encerrada.
      if (state === 'ENDING') {
        factCheckStore.setState({
          sessionId: event.data.sessionId,
          status: 'processing',
          message: event.data.reason ?? 'Encerrando captura; drenando fila…',
        });
        return;
      }
      if (state === 'ENDED') {
        factCheckStore.setState({
          sessionId: event.data.sessionId,
          status: 'finished',
          message: event.data.reason,
        });
        return;
      }
      if (state === 'ERROR') {
        if (this.liveSessionId === event.data.sessionId) {
          void this.audioChunker?.stop({ flush: false });
          this.audioChunker = null;
          this.removeCaptureEndedListener?.();
          this.removeCaptureEndedListener = null;
          this.tabCapture?.stop();
          this.tabCapture = null;
          this.liveSessionId = null;
        }
        factCheckStore.setState({
          sessionId: event.data.sessionId,
          status: 'error',
          error: event.data.reason,
          message: event.data.reason,
        });
        return;
      }
      factCheckStore.setState({
        sessionId: event.data.sessionId,
        status: 'processing',
        message: state,
      });
    });

    socket.on('VERIFICATION_RESULT', (event: VerificationResultEvent) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      const verification = event.data.verification;
      useFactCheckStore.getState().upsertVerification(verification);

      // Drop in-flight placeholder for the same claim once a real card arrives.
      const placeholderId = pendingClaimId(verification.claimId);
      if (placeholderId === verification.id) return;

      const latest = useFactCheckStore.getState().verifications;
      if (latest.some((item) => item.id === placeholderId)) {
        factCheckStore.setState({
          verifications: latest.filter((item) => item.id !== placeholderId),
        });
      }
    });

    socket.on('VERIFICATION_INVALIDATED', (event: VerificationInvalidatedEvent) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      useFactCheckStore.getState().invalidateVerification(event.data);
    });

    socket.on('SESSION_SNAPSHOT', (event: SessionSnapshotEvent) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      useFactCheckStore.getState().applySessionSnapshot(event.data);
    });

    socket.on('CLAIM_DETECTED', (event: ClaimDetectedEvent) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      const claim = event.data.claim;
      // In-flight card: never COMPLETED / never carries a verdict.
      const status =
        claim.status === 'COMPLETED' || claim.status === 'FAILED'
          ? 'RESEARCHING'
          : claim.status;

      useFactCheckStore.getState().upsertVerification({
        id: pendingClaimId(claim.id),
        sessionId: claim.sessionId,
        claimId: claim.id,
        segmentIds: claim.segmentIds,
        speakerId: claim.speakerId,
        originalQuote: claim.originalQuote,
        normalizedClaim: claim.normalizedClaim,
        timestampMs: claim.timestampMs,
        transcriptConfirmed: true,
        atomicClaim:
          claim.atomicClaims[0] ?? {
            id: `${claim.id}-atomic`,
            proposition: claim.normalizedClaim,
          },
        status,
        mechanisms: [],
        supportedAspects: [],
        limitations: [],
        evidence: [],
        sources: [],
        revision: claim.revision,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
      });
    });

    socket.on('CLAIM_STATUS_UPDATED', (event: ClaimStatusUpdatedEvent) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      const store = useFactCheckStore.getState();
      const existing =
        store.verifications.find(
          (item) => item.id === pendingClaimId(event.data.claimId),
        ) ??
        store.verifications.find((item) => item.claimId === event.data.claimId);
      if (!existing) return;
      if (event.data.revision < existing.revision) return;

      // Status-only events must not invent a completed verdict.
      let nextStatus = event.data.status;
      if (nextStatus === 'COMPLETED') {
        nextStatus = 'EVALUATING';
      }

      store.upsertVerification({
        ...existing,
        status: nextStatus,
        revision: event.data.revision,
        verdict: undefined,
        conclusion: undefined,
        contradiction: undefined,
        contradictionEvidenceIds: undefined,
        updatedAt: new Date().toISOString(),
      });
    });

    socket.on('LIVE_SESSION_ENDED', (event) => {
      if (!this.acceptEnvelope(event.envelope)) return;
      if (this.liveSessionId === event.data.sessionId) {
        void this.audioChunker?.stop({ flush: false });
        this.audioChunker = null;
        this.removeCaptureEndedListener?.();
        this.removeCaptureEndedListener = null;
        this.tabCapture?.stop();
        this.tabCapture = null;
        this.liveSessionId = null;
      }
      factCheckStore.setState({
        sessionId: event.data.sessionId,
        status: 'finished',
        message: event.data.reason,
      });
    });
  }

  private async connect(): Promise<void> {
    if (this.socket?.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = io(this.backendUrl, {
        transports: ['websocket', 'polling'],
        timeout: API_CONFIG.WEBSOCKET_TIMEOUT,
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
      });

      this.registerHandlers(this.socket);

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
          description:
            (error as Error & { description?: string }).description ||
            'No description available',
        });
        factCheckStore.setState({
          status: 'error',
          error: `Erro ao conectar com o servidor: ${error.message}`,
        });
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Desconectado do backend:', reason);
        if (this.liveSessionId !== null) {
          void this.audioChunker?.stop({ flush: false });
          this.audioChunker = null;
          this.removeCaptureEndedListener?.();
          this.removeCaptureEndedListener = null;
          this.tabCapture?.stop();
          this.tabCapture = null;
          this.liveSessionId = null;
          factCheckStore.setState({ status: 'interrupted', message: 'A conexão caiu. A captura foi interrompida; inicie uma nova sessão.' });
        }
      });
    });
  }

  /** Starts a live session after the user explicitly selects a tab and grants audio capture. */
  public async startLiveCapture(apiKeys: { google?: string; tavily?: string }): Promise<void> {
    if (this.liveSessionId !== null) throw new Error('Já existe uma captura ao vivo ativa.');
    const capture = await startTabAudioCapture();
    this.tabCapture = capture;
    try {
      await this.connect();
      const socket = this.socket;
      if (!socket) throw new Error('Conexão ao vivo indisponível.');
      const sessionId = globalThis.crypto?.randomUUID?.() ?? `live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.liveSessionId = sessionId;
      factCheckStore.setState({
        sessionId,
        status: 'connecting',
        error: undefined,
        transcriptSegments: [],
        speakerMappings: [],
        speakerMappingRevision: 0,
        verifications: [],
        eventCursor: 0,
        seenEventIds: [],
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('O servidor não confirmou o início da sessão ao vivo.'));
        }, 15_000);
        const onStarted = (event: { data: { sessionId: string } }) => {
          if (event.data.sessionId !== sessionId) return;
          cleanup();
          resolve();
        };
        const onState = (event: { data: { sessionId: string; state: string; reason?: string } }) => {
          if (event.data.sessionId !== sessionId || event.data.state !== 'ERROR') return;
          cleanup();
          reject(new Error(event.data.reason ?? 'Não foi possível iniciar a captura.'));
        };
        const cleanup = () => {
          clearTimeout(timeout);
          socket.off('LIVE_SESSION_STARTED', onStarted);
          socket.off('LIVE_SESSION_STATE', onState);
        };
        socket.on('LIVE_SESSION_STARTED', onStarted);
        socket.on('LIVE_SESSION_STATE', onState);
        socket.emit('START_LIVE_SESSION', {
          sessionId,
          source: 'TAB',
          language: 'pt-BR',
          consent: true,
          apiKeys,
        });
      });

      this.audioChunker = new AudioChunker({
        onChunk: (meta, buffer) => {
          const activeSocket = this.socket;
          const activeSessionId = this.liveSessionId;
          if (!activeSocket?.connected || !activeSessionId) return;
          activeSocket.emit('AUDIO_CHUNK', {
            ...meta,
            sessionId: activeSessionId,
            capturedAt: this.audioChunker?.capturedAt ?? new Date().toISOString(),
          }, buffer);
        },
        onGap: (gap) => {
          factCheckStore.setState({ message: `Trecho de áudio perdido (${gap.fromSample}–${gap.toSample}); a transcrição pode ter uma lacuna.` });
        },
        onError: (error) => {
          factCheckStore.setState({ status: 'error', error: error.message, message: error.message });
        },
      });
      await this.audioChunker.start(capture.stream);
      this.removeCaptureEndedListener = capture.onEnded(() => {
        void this.endLiveCapture('tab_share_ended');
      });
      factCheckStore.setState({ status: 'processing', message: 'Capturando áudio da aba selecionada.' });
    } catch (error) {
      if (this.liveSessionId !== null) {
        this.socket?.emit('CANCEL_LIVE_SESSION', { sessionId: this.liveSessionId });
      }
      this.liveSessionId = null;
      this.tabCapture?.stop();
      this.tabCapture = null;
      this.audioChunker = null;
      throw error;
    }
  }

  public pauseLiveCapture(): void {
    const sessionId = this.liveSessionId;
    if (!sessionId) return;
    this.audioChunker?.pause();
    this.socket?.emit('PAUSE_LIVE_SESSION', { sessionId });
  }

  public updateSpeakerMapping(speakerId: string, participantName: string): void {
    const sessionId = this.liveSessionId;
    const name = participantName.trim();
    if (!sessionId || !name) return;
    const state = useFactCheckStore.getState();
    this.socket?.emit('UPDATE_SPEAKER_MAPPING', {
      sessionId,
      mappings: [{
        speakerId,
        participantName: name,
        confirmed: true,
        revision: state.speakerMappingRevision + 1,
      }],
      expectedRevision: state.speakerMappingRevision,
    });
  }

  public correctTranscript(segmentId: string, text: string, expectedRevision: number): void {
    const sessionId = this.liveSessionId;
    if (!sessionId || !text.trim()) return;
    this.socket?.emit('CORRECT_TRANSCRIPT', {
      sessionId,
      segmentId,
      text: text.trim(),
      expectedRevision,
    });
  }

  public resumeLiveCapture(): void {
    const sessionId = this.liveSessionId;
    if (!sessionId) return;
    this.audioChunker?.resume();
    this.socket?.emit('RESUME_LIVE_SESSION', { sessionId });
  }

  public async endLiveCapture(reason = 'requested'): Promise<void> {
    const sessionId = this.liveSessionId;
    if (!sessionId) return;
    this.removeCaptureEndedListener?.();
    this.removeCaptureEndedListener = null;
    await this.audioChunker?.stop({ flush: true });
    this.audioChunker = null;
    this.tabCapture?.stop();
    this.tabCapture = null;
    this.socket?.emit('END_LIVE_SESSION', { sessionId });
    this.liveSessionId = null;
    factCheckStore.setState({ status: 'processing', message: reason === 'requested' ? 'Encerrando captura e aguardando verificações.' : 'Compartilhamento de áudio encerrado.' });
  }

  public onStateChange(listener: (state: VerificationState) => void): () => void {
    listener(factCheckStore.getState());
    return factCheckStore.subscribe((state) => {
      listener(state);
    });
  }

  public async testConnection(): Promise<boolean> {
    try {
      console.log('🧪 Testando conectividade com o backend...');
      console.log('🌐 URL:', this.backendUrl);

      const response = await fetch(`${this.backendUrl}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const healthData = await response.json();
      console.log('✅ Health check OK:', healthData);

      if (!healthData.status) {
        console.warn('⚠️ API pode ter mudado: campo "status" não encontrado na resposta');
      }

      await this.connect();
      console.log('✅ WebSocket conectado');

      return true;
    } catch (error) {
      console.error('❌ Teste de conectividade falhou:', error);
      return false;
    }
  }

  public async requestFactCheck(
    content: string,
    options: RequestOptions = {},
  ): Promise<string> {
    if (!content.trim()) {
      throw new Error('Conteúdo não pode estar vazio');
    }

    try {
      if (!this.isConnected()) {
        await this.connect();
      }

      const fingerprint = this.generateFingerprint();

      // New explicit text run clears progressive state.
      // Mere navigation must not call this — ResultsPage already guards on existing results.
      factCheckStore.setState({
        status: 'connecting',
        results: [],
        verifications: [],
        sessionId: null,
        eventCursor: 0,
        seenEventIds: [],
        chunkCount: undefined,
        error: undefined,
        message: 'Conectando ao servidor...',
        processedText: content,
        fingerprint,
      });

      const request: FactCheckRequest = {
        fingerprint,
        researchThreshold:
          options.researchThreshold ?? API_CONFIG.DEFAULT_RESEARCH_THRESHOLD,
        apiKeys: {
          google: options.apiKeys?.google ?? '',
          tavily: options.apiKeys?.tavily ?? '',
        },
      };

      if (!this.socket) {
        throw new Error('Conexão com o backend não está disponível.');
      }
      this.socket.emit('REQUEST_FACT_CHECK', content, request);

      return fingerprint;
    } catch (error) {
      console.error('Erro ao enviar requisição de verificação:', error);
      factCheckStore.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
      throw error;
    }
  }

  public getState(): VerificationState {
    return factCheckStore.getState();
  }

  public getProcessedText(): string {
    return factCheckStore.getState().processedText;
  }

  public reset(): void {
    useFactCheckStore.getState().reset();
  }

  /**
   * Disconnects the socket without wiping progressive results.
   * Navigation / remount must not restart or clear an active verification.
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  public isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export const factCheckService = new FactCheckService();
