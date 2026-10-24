import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  UpdateStatus,
} from './types.js';
import { ValidationError } from '#/utils/errors.js';
import {
  isOriginAllowed,
  parseAllowedOrigins,
  redactSecrets,
} from '#/utils/security.js';

export type * from './types.js';

export const MAX_SOCKET_MESSAGE_BYTES = 512 * 1024;

export type WebSocketServerOptions = {
  /**
   * Browser origins allowed to open a socket. Defaults to the local
   * development origins; `main.ts` passes `CORS_ORIGINS` explicitly.
   */
  allowedOrigins?: readonly string[];
};

export const emitUpdateStatus = (
  socket: Socket,
  fingerprint: string,
  status: UpdateStatus['data']['status'],
  message?: string,
) => {
  const updateStatus: UpdateStatus = {
    data: { status, message },
    meta: { fingerprint },
  };
  socket.emit('UPDATE_STATUS', updateStatus);
};

// Socket.io server setup
export function createWebSocketServer(
  httpServer: HttpServer,
  onConnection: (
    socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  ) => void,
  options: WebSocketServerOptions = {},
) {
  const allowedOrigins = [...(options.allowedOrigins ?? parseAllowedOrigins())];

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
      },
      // Binary/message cap (LIVE-038): one audio chunk is at most
      // LIVE_PAYLOAD_LIMITS.maxChunkSamples * 2 bytes (320 KB); 512 KB leaves
      // room for the JSON metadata. Larger frames close the connection.
      maxHttpBufferSize: MAX_SOCKET_MESSAGE_BYTES,
      // CORS is enforced by the browser only, so unknown browser origins are
      // also rejected at the handshake. Requests without Origin are allowed.
      allowRequest: (req, callback) => {
        callback(null, isOriginAllowed(req.headers.origin, allowedOrigins));
      },
    },
  );

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    onConnection(socket);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

export const handleWebSocketError = (
  error: unknown,
  socket: Socket,
  fingerprint: string,
) => {
  if (error instanceof ValidationError) {
    emitUpdateStatus(
      socket,
      fingerprint,
      'EXCEPTION',
      redactSecrets(error.message),
    );
    return;
  }
  emitUpdateStatus(socket, fingerprint, 'EXCEPTION', 'Internal server error');
};
