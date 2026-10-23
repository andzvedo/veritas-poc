import 'dotenv/config';

import { DEFAULT_ADVANCED_MODEL, DEFAULT_FAST_MODEL } from '#/llm/config.js';
import { factCheckService } from '#/service/factCheckService.js';
import {
  isOriginAllowed,
  parseAllowedOrigins,
  redactSecrets,
  safeErrorForLog,
  validateFactCheckRequestPayload,
} from '#/utils/security.js';
import {
  ChunkCount,
  createWebSocketServer,
  emitUpdateStatus,
  handleWebSocketError,
} from '#/ws/index.js';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';

// Allowed browser origins (CORS_ORIGINS is a comma-separated list).
const allowedOrigins = parseAllowedOrigins(process.env['CORS_ORIGINS']);

// Express app setup
const app = express();

app.use(helmet());

// Reject unknown browser origins up front; requests without Origin (non-browser
// clients) are allowed through.
app.use((req, res, next) => {
  if (isOriginAllowed(req.headers.origin, allowedOrigins)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Origin not allowed' });
});

app.use(cors({ origin: allowedOrigins }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

// How much of the submitted text is echoed in logs.
const CONTENT_PREVIEW_LENGTH = 40;

// Create HTTP server
const httpServer = createServer(app);

// Initialize WebSocket server
createWebSocketServer(
  httpServer,
  (socket) => {
    console.log('Client connected: ', socket.id);

    // One in-flight fact check per socket, reset on finish/error.
    let isProcessing = false;
    let activeAbort: AbortController | undefined;

    const abortActiveFactCheck = (reason: string) => {
      if (activeAbort === undefined || activeAbort.signal.aborted) {
        return;
      }
      const error = new Error(reason);
      error.name = 'AbortError';
      activeAbort.abort(error);
    };

    socket.on('disconnect', () => {
      abortActiveFactCheck('client disconnected');
    });

    // Handle fact check requests
    socket.on('REQUEST_FACT_CHECK', async (content, data) => {
      let fingerprint = 'unknown';
      let started = false;
      const abortController = new AbortController();

      // The whole handler is guarded: a malformed payload or a service failure
      // must never reject the listener and take the process down.
      try {
        const validation = validateFactCheckRequestPayload(content, data);
        if (!validation.ok) {
          console.warn('Rejected fact check request', {
            fingerprint: validation.fingerprint,
            reason: validation.message,
          });
          emitUpdateStatus(
            socket,
            validation.fingerprint,
            'EXCEPTION',
            validation.message,
          );
          return;
        }

        const { content: text, request } = validation;
        fingerprint = request.fingerprint;

        if (isProcessing) {
          emitUpdateStatus(
            socket,
            fingerprint,
            'EXCEPTION',
            'A fact check is already running for this connection',
          );
          return;
        }

        // The request carries API keys: log metadata only, never the object.
        console.log('Fact check request received', {
          fingerprint,
          contentLength: text.length,
          contentPreview: redactSecrets(text.slice(0, CONTENT_PREVIEW_LENGTH)),
        });

        started = true;
        isProcessing = true;
        activeAbort = abortController;

        emitUpdateStatus(
          socket,
          fingerprint,
          'PROCESSING',
          'Started processing fact check request...',
        );

        const factCheckGenerator = factCheckService(text, request, {
          signal: abortController.signal,
        });
        for await (const result of factCheckGenerator) {
          if (abortController.signal.aborted) {
            break;
          }
          type Res = typeof result;
          const isChunkCount = (v: Res): v is ChunkCount =>
            'chunkCount' in v.data;

          if (isChunkCount(result)) {
            socket.emit('CHUNK_COUNT', result);
          } else {
            socket.emit('FACT_CHECK_RESULT', result);
          }
        }

        if (abortController.signal.aborted) {
          emitUpdateStatus(
            socket,
            fingerprint,
            'INTERRUPTED',
            'Fact check cancelled',
          );
          return;
        }

        emitUpdateStatus(
          socket,
          fingerprint,
          'FINISHED',
          'Fact check completed',
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || abortController.signal.aborted)
        ) {
          emitUpdateStatus(
            socket,
            fingerprint,
            'INTERRUPTED',
            'Fact check cancelled',
          );
          return;
        }
        // Keep raw requests, API keys and headers out of error logs.
        console.error('Error processing fact check', {
          fingerprint,
          error: safeErrorForLog(error),
        });
        handleWebSocketError(error, socket, fingerprint);
      } finally {
        // Only the invocation that acquired the guard may release it.
        if (started) {
          isProcessing = false;
          if (activeAbort === abortController) {
            activeAbort = undefined;
          }
        }
      }
    });
  },
  { allowedOrigins },
);

httpServer.listen(PORT, () => {
  console.log(`Veritas API running on port ${PORT.toString()}`);
  console.log(`WebSocket server initialized`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  const fastModel = DEFAULT_FAST_MODEL;
  const advancedModel = DEFAULT_ADVANCED_MODEL;
  console.log(`Fast model: ${fastModel.provider}/${fastModel.model}`);
  console.log(
    `Advanced model: ${advancedModel.provider}/${advancedModel.model}`,
  );
});
