// Mock do factCheckService para o Ladle
export const factCheckService = {
  onStateChange: (callback: (state: {
    status: string;
    results: unknown[];
    verifications: unknown[];
    sessionId: string | null;
    eventCursor: number;
    seenEventIds: string[];
    error: unknown;
  }) => void) => {
    callback({
      status: 'idle',
      results: [],
      verifications: [],
      sessionId: null,
      eventCursor: 0,
      seenEventIds: [],
      error: null,
    });
    return () => {};
  },
  disconnect: () => {
    console.log('[Mock] factCheckService.disconnect called');
  },
  reset: () => {
    console.log('[Mock] factCheckService.reset called');
  },
  testConnection: async () => {
    console.log('[Mock] factCheckService.testConnection called');
    return true;
  },
  requestFactCheck: async (text: string) => {
    console.log(
      '[Mock] factCheckService.requestFactCheck called with:',
      text.substring(0, 50) + '...',
    );
    return 'mock-fingerprint-' + Date.now();
  },
  getState: () => ({
    status: 'idle',
    results: [],
    verifications: [],
    sessionId: null,
    eventCursor: 0,
    seenEventIds: [],
    error: null,
    processedText: '',
    fingerprint: null,
  }),
  getProcessedText: () => '',
  isConnected: () => true,
};
