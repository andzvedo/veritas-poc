import { describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io';
import { attachLiveSessionHandlers } from '#/ws/liveHandlers.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@veritas/shared';

describe('live socket payload validation', () => {
  it('reports a null START_LIVE_SESSION payload instead of throwing', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const emitted: { event: string; payload: unknown }[] = [];
    const socket = {
      id: 'test-socket',
      on: (event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      },
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
    } as unknown as Socket<ClientToServerEvents, ServerToClientEvents>;

    attachLiveSessionHandlers(socket);
    expect(() => handlers.get('START_LIVE_SESSION')?.(null)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('LIVE_SESSION_STATE');
    expect(emitted[0].payload).toMatchObject({ data: { state: 'ERROR' } });
  });
});
