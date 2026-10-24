import { create } from 'zustand';
import type {
  FactCheckResult,
  SessionSnapshotData,
  Verification,
  VerificationInvalidatedData,
  VerificationState,
  VerificationStatus,
} from '../types/api';
import type { SpeakerMapping, TranscriptSegment } from '@veritas/shared';
import {
  applySessionSnapshotVerifications,
  applyVerificationInvalidation,
  factCheckResultId,
  factCheckResultToVerification,
  upsertByRevision,
} from './verificationSync';

type FactCheckStoreState = VerificationState & {
  transcriptSegments: TranscriptSegment[];
  speakerMappings: SpeakerMapping[];
  speakerMappingRevision: number;
};

interface FactCheckStoreActions {
  update: (updates: Partial<FactCheckStoreState>) => void;
  setStatus: (status: VerificationStatus, message?: string) => void;
  /** @deprecated Prefer upsertVerification / upsertFactCheckResult — append is blind. */
  addResult: (result: FactCheckResult) => void;
  upsertFactCheckResult: (result: FactCheckResult) => void;
  upsertVerification: (verification: Verification) => void;
  invalidateVerification: (payload: VerificationInvalidatedData) => void;
  applySessionSnapshot: (snapshot: SessionSnapshotData) => void;
  upsertTranscriptSegment: (segment: TranscriptSegment) => void;
  setSpeakerMappings: (mappings: SpeakerMapping[], revision: number) => void;
  rememberEventId: (eventId: string) => boolean;
  advanceCursor: (eventSeq: number) => void;
  reset: () => void;
}

export type FactCheckStore = FactCheckStoreState & FactCheckStoreActions;

const initialState: FactCheckStoreState = {
  status: 'idle',
  results: [],
  verifications: [],
  transcriptSegments: [],
  speakerMappings: [],
  speakerMappingRevision: 0,
  sessionId: null,
  eventCursor: 0,
  seenEventIds: [],
  processedText: '',
  fingerprint: null,
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
        transcriptSegments: snapshot.segments,
        verifications: merged.items,
        eventCursor: Math.max(state.eventCursor, merged.cursor),
      };
    }),
  upsertTranscriptSegment: (segment) =>
    set((state) => {
      if (state.sessionId !== null && segment.sessionId !== state.sessionId) {
        return state;
      }
      const index = state.transcriptSegments.findIndex((item) => item.id === segment.id);
      if (index === -1) {
        return { transcriptSegments: [...state.transcriptSegments, segment] };
      }
      if (state.transcriptSegments[index].revision >= segment.revision) return state;
      const transcriptSegments = [...state.transcriptSegments];
      transcriptSegments[index] = segment;
      return { transcriptSegments };
    }),
  setSpeakerMappings: (mappings, revision) => set({ speakerMappings: mappings, speakerMappingRevision: revision }),
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
