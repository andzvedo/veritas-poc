// Re-exporta todos os tipos do módulo compartilhado
// Isso mantém a compatibilidade com o código existente
// enquanto centraliza as definições de tipos
export {
  // Schemas Zod (se necessário no frontend)
  FACT_CHECK_REQUEST_SCHEMA,
  FACT_CHECK_RESULT_DATA_SCHEMA,
  FACT_CHECK_RESULT_SCHEMA,
  UPDATE_STATUS_SCHEMA,
  CHUNK_COUNT_SCHEMA,
  
  // Types TypeScript
  type FactCheckRequest,
  type FactCheckResultData,
  type FactCheckResult,
  type UpdateStatus,
  type UpdateStatusData,
  type ChunkCount,
  type ChunkCountData,
  
  // Eventos Socket.IO
  type ClientToServerEvents,
  type ServerToClientEvents,
  
  // Estados da Verificação
  type VerificationStatus,
  type VerificationState,

  // Live progressive contracts (LIVE-027/028)
  type Verification,
  type SessionSnapshotData,
  type VerificationInvalidatedData,
} from '@veritas/shared';
