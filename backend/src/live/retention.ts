/**
 * Retention constants of live sessions (LIVE-038/LIVE-040).
 *
 * P0 keeps everything in process memory: nothing is written to disk, audio is
 * discarded after transcription and a restart makes the session unavailable.
 * See docs/LIVE-SEGURANCA-RETENCAO.md.
 */
export const DEFAULT_LIVE_SESSION_IDLE_MS = 15 * 60 * 1000;
export const DEFAULT_LIVE_MAX_SESSIONS = 32;
/** Live sessions a single socket may own at the same time. */
export const DEFAULT_LIVE_MAX_SESSIONS_PER_SOCKET = 2;
/** Superseded claims / verifications kept in memory for audit and export. */
export const DEFAULT_LIVE_MAX_SUPERSEDED = 500;
