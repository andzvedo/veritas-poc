'use client';

import { useEffect, useState } from 'react';
import { factCheckService } from '@/lib/services/factCheckService';
import { liveSessionController } from '@/lib/live/liveSessionController';
import { useFactCheckStore } from '@/lib/store/factCheckStore';

/**
 * Compatibility panel from LIVE capture PR #6.
 * Prefer ModeToggle + LiveSetupPanel on `/verification` and `/live`.
 * Kept so existing imports keep working against the shared store/controller.
 */
export default function LiveCapturePanel({
  apiKeys,
}: {
  apiKeys: { google?: string; tavily?: string };
}) {
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  const segments = useFactCheckStore((state) => state.segments);
  const speakerMappings = useFactCheckStore((state) => state.speakerMappings);
  const speakerMappingRevision = useFactCheckStore(
    (state) => state.speakerMappingRevision,
  );
  const sessionId = useFactCheckStore((state) => state.sessionId);
  const captureFeedback = useFactCheckStore((state) => state.captureFeedback);
  const status = useFactCheckStore((state) => state.status);

  const capturing =
    captureFeedback === 'capturing' || captureFeedback === 'paused';
  const paused = captureFeedback === 'paused';

  useEffect(() => {
    if (status === 'interrupted') {
      setError(
        'A conexão foi interrompida. Inicie uma nova captura para continuar.',
      );
    }
  }, [status]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await liveSessionController.start({ apiKeys });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível iniciar a captura.',
      );
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await liveSessionController.stop();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível encerrar a captura.',
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    setBusy(true);
    try {
      if (paused) await liveSessionController.resume();
      else await liveSessionController.pause();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível alterar a captura.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="w-full rounded-2xl border border-[var(--divider)] bg-white/90 p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-[var(--text-title)]">
        Verificação ao vivo
      </h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        O Veritas escuta o ambiente pelo microfone e envia somente esse áudio
        para transcrição e análise.
      </p>
      {!capturing ? (
        <>
          <label className="mt-4 flex items-start gap-3 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              className="mt-1"
            />
            <span>
              Confirmo que as pessoas no ambiente sabem que a conversa será
              gravada pelo microfone e enviada ao Veritas para transcrição e
              verificação.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!consented || busy}
            className="mt-4 rounded-lg bg-[var(--purple-button)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Conectando…' : 'Iniciar escuta pelo microfone'}
          </button>
        </>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm" role="status">
            {paused
              ? 'Captura pausada'
              : status === 'processing'
                ? 'Capturando e verificando'
                : status}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void togglePause()}
            className="rounded-lg border px-4 py-2 text-sm font-medium"
          >
            {paused ? 'Retomar' : 'Pausar'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void stop()}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
          >
            Encerrar captura
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {segments.length > 0 && (
        <div
          className="mt-5 max-h-64 space-y-3 overflow-y-auto border-t pt-4"
          aria-live="polite"
          aria-label="Transcrição ao vivo"
        >
          {segments.map((segment) => (
            <div key={segment.id} className="text-sm text-[var(--text-primary)]">
              <span className="mr-2 text-xs text-[var(--text-secondary)]">
                {segment.status === 'PROVISIONAL' ? 'Parcial' : 'Transcrição'}
              </span>
              <span>{segment.text}</span>
              {capturing && segment.status !== 'PROVISIONAL' && sessionId && (
                <div className="mt-1 flex gap-2">
                  <input
                    aria-label="Corrigir transcrição"
                    value={corrections[segment.id] ?? segment.text}
                    onChange={(event) =>
                      setCorrections((current) => ({
                        ...current,
                        [segment.id]: event.target.value,
                      }))
                    }
                    className="min-w-0 flex-1 rounded-md border px-2 py-1"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      factCheckService.correctTranscript({
                        sessionId,
                        segmentId: segment.id,
                        expectedRevision: segment.revision,
                        text: corrections[segment.id] ?? segment.text,
                      })
                    }
                    className="rounded-md border px-3 py-1"
                  >
                    Corrigir
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {capturing &&
        Array.from(
          new Set(
            segments
              .map((segment) => segment.speakerId)
              .filter((id): id is string => Boolean(id)),
          ),
        ).map((speakerId) => {
          const mapping = speakerMappings.find(
            (item) => item.speakerId === speakerId && item.confirmed,
          );
          return (
            <div
              key={speakerId}
              className="mt-3 flex flex-wrap items-center gap-2 text-sm"
            >
              <span>
                {mapping?.participantName ?? `Locutor ${speakerId}`}
              </span>
              {!mapping && sessionId && (
                <>
                  <input
                    aria-label={`Nome para ${speakerId}`}
                    value={speakerNames[speakerId] ?? ''}
                    onChange={(event) =>
                      setSpeakerNames((current) => ({
                        ...current,
                        [speakerId]: event.target.value,
                      }))
                    }
                    placeholder="Nome do candidato"
                    className="rounded-md border px-2 py-1"
                  />
                  <button
                    type="button"
                    disabled={!speakerNames[speakerId]?.trim()}
                    onClick={() =>
                      factCheckService.updateSpeakerMapping({
                        sessionId,
                        expectedRevision: speakerMappingRevision,
                        mappings: [
                          {
                            speakerId,
                            participantName: speakerNames[speakerId] ?? '',
                            confirmed: true,
                            revision: speakerMappingRevision + 1,
                          },
                        ],
                      })
                    }
                    className="rounded-md border px-3 py-1 disabled:opacity-50"
                  >
                    Associar
                  </button>
                </>
              )}
            </div>
          );
        })}
      <p className="mt-4 text-xs text-[var(--text-secondary)]">
        A identificação do candidato pode exigir associação manual; o sistema não
        deve presumir quem falou.
      </p>
    </section>
  );
}
