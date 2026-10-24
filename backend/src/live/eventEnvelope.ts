/**
 * Stamps server→client live events with the shared envelope contract.
 * The transport (Socket.IO) only forwards the resulting `{ envelope, data }`.
 */
import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type EventEnvelope } from '@veritas/shared';

export type EnvelopeClock = () => Date;

export class LiveEventSequencer {
  private eventSeq = 0;
  private readonly clock: EnvelopeClock;

  constructor(clock: EnvelopeClock = () => new Date()) {
    this.clock = clock;
  }

  /** Last stamped eventSeq (0 before the first emission). */
  getCursor(): number {
    return this.eventSeq;
  }

  next(sessionId?: string): EventEnvelope {
    this.eventSeq += 1;
    return {
      protocolVersion: PROTOCOL_VERSION,
      eventId: randomUUID(),
      ...(sessionId === undefined ? {} : { sessionId }),
      eventSeq: this.eventSeq,
      emittedAt: this.clock().toISOString(),
    };
  }
}

export function stampEvent<T>(
  sequencer: LiveEventSequencer,
  data: T,
  sessionId?: string,
): { envelope: EventEnvelope; data: T } {
  return { envelope: sequencer.next(sessionId), data };
}
