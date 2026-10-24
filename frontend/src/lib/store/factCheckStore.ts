import { create } from 'zustand';
import type {
  Claim,
  FactCheckResult,
  LiveCaptureFeedback,
  LiveGapData,
  LiveMetricsData,
  LiveSessionErrorCode,
  LiveSessionState,
  SessionSnapshotData,
  SpeakerMapping,
  TranscriptSegment,
  Verification,
  VerificationInvalidatedData,
  VerificationState,
  VerificationStatus,
} from '../types/api';
import {
  applySessionSnapshotVerifications,
  applyVerificationInvalidation,
  factCheckResultId,
  factCheckResultToVerification,
  upsertByRevision,
} from './verificationSync';
import {
  applySpeakerMappings,
  mergeSnapshotClaims,
  mergeSnapshotSegments,
  upsertTranscriptSegment,
} from './transcriptSync';

type FactCheckStoreState = VerificationState;

interface FactCheckStoreActions {
  update: (updates: Partial<FactCheckStoreState>) => void;
  setStatus: (status: VerificationStatus, message?: string) => void;
  /** @deprecated Prefer upsertVerification / upsertFactCheckResult — append is blind. */
  addResult: (result: FactCheckResult) => void;
  upsertFactCheckResult: (result: FactCheckResult) => void;
  upsertVerification: (verification: Verification) => void;
  invalidateVerification: (payload: VerificationInvalidatedData) => void;
  applySessionSnapshot: (snapshot: SessionSnapshotData) => void;
  upsertSegment: (
    segment: TranscriptSegment,
    options?: { treatStaleAsConflict?: boolean },
  ) => void;
  upsertClaim: (claim: Claim) => void;
  setSpeakerMappings: (
    mappings: readonly SpeakerMapping[],
    revision: number,
  ) => void;
  setLiveSessionState: (
    state: LiveSessionState | null,
    extras?: { message?: string; reason?: string; code?: LiveSessionErrorCode },
  ) => void;
  setCaptureFeedback: (feedback: LiveCaptureFeedback, error?: string) => void;
  pushLiveGap: (gap: LiveGapData) => void;
  setLiveMetrics: (metrics: LiveMetricsData) => void;
  clearSegmentConflict: (segmentId: string) => void;
  rememberEventId: (eventId: string) => boolean;
  advanceCursor: (eventSeq: number) => void;
  reset: () => void;
  resetLiveTranscript: () => void;
}

export type FactCheckStore = FactCheckStoreState & FactCheckStoreActions;

const initialState: FactCheckStoreState = {
  status: 'idle',
  results: [],
  verifications: [],
  sessionId: null,
  eventCursor: 0,
  seenEventIds: [],
  processedText: '',
  fingerprint: null,
  liveSessionState: null,
  liveErrorCode: null,
  segments: [],
  speakerMappings: [],
  speakerMappingRevision: 0,
  claims: [],
  segmentConflicts: [],
  liveGaps: [],
  liveMetrics: null,
  captureFeedback: 'idle',
  lastTranscriptAt: null,
};

export const useFactCheckStore = create<FactCheckStore>((set, get) => ({
  ...initialState,
  update: (updates) => set((state) => ({ ...state, ...updates })),
  setStatus: (status, message) =>
    set((state) => ({
      ...state,
      status,
      message,
    })),
  addResult: (result) => {
    get().upsertFactCheckResult(result);
  },
  upsertFactCheckResult: (result) =>
    set((state) => {
      const id = factCheckResultId(result);
      const existingIndex = state.results.findIndex(
        (item) => factCheckResultId(item) === id,
      );

      // Legacy text-mode ids are fingerprint+chunk+seq (one card per claim event).
      // Exact id repeats are duplicates — never blind-append.
      if (existingIndex !== -1) {
        return state;
      }

      const bridged = factCheckResultToVerification(result, {
        sessionId: state.sessionId,
      });
      const upserted = upsertByRevision(
        state.verifications,
        bridged,
        state.sessionId,
      );

      return {
        ...state,
        results: [...state.results, result],
        verifications: upserted.items,
      };
    }),
  upsertVerification: (verification) =>
    set((state) => {
      const upserted = upsertByRevision(
        state.verifications,
        verification,
        state.sessionId,
      );
      if (!upserted.applied) {
        return state;
      }
      return {
        ...state,
        verifications: upserted.items,
      };
    }),
  invalidateVerification: (payload) =>
    set((state) => {
      const result = applyVerificationInvalidation(
        state.verifications,
        payload,
        state.sessionId,
      );
      if (!result.applied) {
        return state;
      }
      return {
        ...state,
        verifications: result.items,
      };
    }),
  applySessionSnapshot: (snapshot) =>
    set((state) => {
      if (state.sessionId !== null && state.sessionId !== snapshot.sessionId) {
        return state;
      }
      const merged = applySessionSnapshotVerifications(
        state.verifications,
        snapshot,
      );
      return {
        ...state,
        sessionId: snapshot.sessionId,
        liveSessionState: snapshot.state,
        verifications: merged.items,
        segments: mergeSnapshotSegments(state.segments, snapshot),
        claims: mergeSnapshotClaims(state.claims, snapshot),
        eventCursor: Math.max(state.eventCursor, merged.cursor),
      };
    }),
  upsertSegment: (segment, options) =>
    set((state) => {
      const result = upsertTranscriptSegment(
        state.segments,
        segment,
        state.sessionId,
        options,
      );
      if (!result.applied && !result.conflict) {
        return state;
      }

      const conflicts = result.conflict
        ? state.segmentConflicts.includes(segment.id)
          ? state.segmentConflicts
          : [...state.segmentConflicts, segment.id]
        : state.segmentConflicts.filter((id) => id !== segment.id);

      return {
        ...state,
        segments: result.applied ? result.items : state.segments,
        segmentConflicts: conflicts,
        lastTranscriptAt: result.applied
          ? new Date().toISOString()
          : state.lastTranscriptAt,
      };
    }),
  upsertClaim: (claim) =>
    set((state) => {
      const upserted = upsertByRevision(state.claims, claim, state.sessionId);
      if (!upserted.applied) {
        return state;
      }
      return {
        ...state,
        claims: upserted.items,
      };
    }),
  setSpeakerMappings: (mappings, revision) =>
    set((state) => {
      const applied = applySpeakerMappings(
        state.speakerMappings,
        state.speakerMappingRevision,
        mappings,
        revision,
      );
      if (!applied.applied) {
        return state;
      }
      return {
        ...state,
        speakerMappings: applied.mappings,
        speakerMappingRevision: applied.revision,
      };
    }),
  setLiveSessionState: (liveSessionState, extras) =>
    set((state) => ({
      ...state,
      liveSessionState,
      message: extras?.message ?? extras?.reason ?? state.message,
      liveErrorCode:
        liveSessionState === 'ERROR' ? (extras?.code ?? null) : null,
      ...(liveSessionState === 'ERROR'
        ? { status: 'error' as const, error: extras?.reason ?? state.error }
        : {}),
      ...(liveSessionState === 'ENDED'
        ? { status: 'finished' as const, captureFeedback: 'ended' as const }
        : {}),
      ...(liveSessionState === 'ENDING'
        ? { captureFeedback: 'ending' as const, status: 'processing' as const }
        : {}),
      ...(liveSessionState === 'LISTENING'
        ? { status: 'processing' as const }
        : {}),
      ...(liveSessionState === 'PAUSED'
        ? { captureFeedback: 'paused' as const, status: 'processing' as const }
        : {}),
    })),
  setCaptureFeedback: (captureFeedback, error) =>
    set((state) => ({
      ...state,
      captureFeedback,
      ...(error !== undefined
        ? { error, status: 'error' as const, message: error }
        : {}),
    })),
  pushLiveGap: (gap) =>
    set((state) => {
      if (state.sessionId !== null && gap.sessionId !== state.sessionId) {
        return state;
      }
      const exists = state.liveGaps.some(
        (item) =>
          item.fromSample === gap.fromSample &&
          item.toSample === gap.toSample &&
          item.reason === gap.reason,
      );
      if (exists) return state;
      return {
        ...state,
        liveGaps: [...state.liveGaps, gap].slice(-100),
      };
    }),
  setLiveMetrics: (liveMetrics) =>
    set((state) => {
      if (
        state.sessionId !== null &&
        liveMetrics.sessionId !== undefined &&
        liveMetrics.sessionId !== state.sessionId
      ) {
        return state;
      }
      return { ...state, liveMetrics };
    }),
  clearSegmentConflict: (segmentId) =>
    set((state) => ({
      ...state,
      segmentConflicts: state.segmentConflicts.filter((id) => id !== segmentId),
    })),
  rememberEventId: (eventId) => {
    const state = get();
    if (state.seenEventIds.includes(eventId)) {
      return false;
    }
    set({
      seenEventIds: [...state.seenEventIds, eventId].slice(-500),
    });
    return true;
  },
  advanceCursor: (eventSeq) =>
    set((state) => ({
      ...state,
      eventCursor: Math.max(state.eventCursor, eventSeq),
    })),
  reset: () =>
    set(() => ({
      ...initialState,
    })),
  resetLiveTranscript: () =>
    set((state) => ({
      ...state,
      segments: [],
      claims: [],
      segmentConflicts: [],
      liveGaps: [],
      liveMetrics: null,
      speakerMappings: [],
      speakerMappingRevision: 0,
      lastTranscriptAt: null,
      liveSessionState: null,
      liveErrorCode: null,
      captureFeedback: 'idle',
    })),
}));

// Exporta a store para uso no serviço (sem React)
export const factCheckStore = {
  getState: () => useFactCheckStore.getState(),
  setState: (updates: Partial<FactCheckStoreState>) =>
    useFactCheckStore.setState(updates),
  subscribe: (listener: (state: FactCheckStore) => void) =>
    useFactCheckStore.subscribe(listener),
};

export const getFactCheckState = () => useFactCheckStore.getState();

export const setFactCheckState = (updates: Partial<FactCheckStoreState>) =>
  useFactCheckStore.setState((state) => ({ ...state, ...updates }));

export const resetFactCheckState = () => useFactCheckStore.getState().reset();
