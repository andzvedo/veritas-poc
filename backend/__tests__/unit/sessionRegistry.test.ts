import { describe, expect, it } from 'vitest';
import { LiveSessionRegistry } from '#/live/sessionRegistry.js';
import type { LivePipeline } from '#/live/livePipeline.js';

describe('LiveSessionRegistry ownership', () => {
  it('does not allow a different socket to reclaim a session by id alone', () => {
    const registry = new LiveSessionRegistry();
    const pipeline = {
      sessionId: 'session-1',
      ownerSocketId: 'original-socket',
      clearCredentials: () => undefined,
      setIdleTtlMs: () => undefined,
      getStatus: () => ({ captureState: 'LISTENING' }),
    } as unknown as LivePipeline;

    registry.register(pipeline);

    expect(registry.reclaim('session-1', 'different-socket')).toBeUndefined();
    expect(pipeline.ownerSocketId).toBe('original-socket');
    expect(registry.reclaim('session-1', 'original-socket')).toBe(pipeline);
  });
});
