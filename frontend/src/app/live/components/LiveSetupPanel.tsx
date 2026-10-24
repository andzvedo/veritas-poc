"use client";

import React, { useCallback, useEffect, useId, useState } from 'react';
import { Info, Mic, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/app/shared/components/ui/button';
import { interpolate, useI18n } from '@/lib/i18n/I18nContext';
import {
  getMicSupportProblem,
  listMicrophones,
  requestMicrophoneList,
  type MicrophoneDevice,
} from '@/lib/audio/micCapture';

export interface LiveStartRequest {
  /** Empty string = system default microphone. */
  deviceId: string;
}

interface LiveSetupPanelProps {
  onStart: (request: LiveStartRequest) => void;
  starting?: boolean;
  className?: string;
}

/**
 * Pre-capture setup for Live mode (LIVE-025).
 * Audio source is the microphone (room recording) since 2026-10-23 — tab
 * sharing was dropped by user decision. Start requires explicit consent.
 */
const LiveSetupPanel: React.FC<LiveSetupPanelProps> = ({
  onStart,
  starting = false,
  className,
}) => {
  const { t } = useI18n();
  const selectId = useId();
  const consentId = useId();
  const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [consented, setConsented] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [supportProblem, setSupportProblem] = useState<
    ReturnType<typeof getMicSupportProblem>
  >(null);

  const refreshDevices = useCallback(async () => {
    const list = await listMicrophones();
    setDevices(list);
    setDeviceId((current) =>
      current && !list.some((d) => d.deviceId === current) ? '' : current,
    );
  }, []);

  useEffect(() => {
    setSupportProblem(getMicSupportProblem());
    void refreshDevices();
    const mediaDevices =
      typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.addEventListener) return;
    const onChange = () => void refreshDevices();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  // Labels are hidden by the browser until mic permission is granted once.
  const labelsHidden = devices.length === 0 || devices.every((d) => !d.label);

  const handleShowDevices = async () => {
    setLoadingDevices(true);
    setDeviceError(null);
    try {
      const list = await requestMicrophoneList({ messages: t.live.micErrors });
      setDevices(list);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDevices(false);
    }
  };

  const supportMessage = supportProblem ? t.live.micErrors[supportProblem] : null;

  return (
    <div
      className={cn(
        'flex flex-col gap-4 w-full rounded-[16px] border border-[bg-violet-900/20] bg-[#f2f2f2] p-4 shadow-[0px_20px_80px_0px_rgba(137,44,219,0.2)] backdrop-blur-[1.5px]',
        className,
      )}
      data-slot="live-setup-panel"
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#755a97] mb-2">
          {t.live.setup.eyebrow}
        </p>
        <h2 className="text-lg font-bold text-[#292236] mb-1">
          {t.live.setup.title}
        </h2>
        <p className="text-sm text-[#81788b] leading-relaxed">
          {t.live.setup.description}
        </p>
      </div>

      <div className="rounded-xl border border-[#e4ddec] bg-white px-3 py-3">
        <label
          htmlFor={selectId}
          className="block text-xs font-semibold text-[#60526c] mb-1.5"
        >
          {t.live.setup.sourceLabel}
        </label>
        <div className="relative">
          <Mic className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#8a5cda]" />
          <select
            id={selectId}
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            disabled={starting || Boolean(supportProblem)}
            className="w-full appearance-none rounded-lg border border-[#d7d4de] bg-[#faf9fc] py-2.5 pl-9 pr-3 text-sm font-medium text-[#292236] focus:outline-none focus:ring-2 focus:ring-[#8a5cda]/40 disabled:opacity-60"
          >
            <option value="">{t.live.setup.defaultMic}</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label ||
                  interpolate(t.live.setup.unnamedMic, { index: index + 1 })}
              </option>
            ))}
          </select>
        </div>
        {labelsHidden && !supportProblem && (
          <button
            type="button"
            onClick={handleShowDevices}
            disabled={loadingDevices || starting}
            className="mt-2 text-xs font-semibold text-[#8a5cda] underline-offset-2 hover:underline disabled:opacity-60"
          >
            {loadingDevices
              ? t.live.setup.loadingDevices
              : t.live.setup.showDevices}
          </button>
        )}
        <p className="mt-2 flex items-start gap-2 text-xs text-[#81788b] leading-relaxed">
          <Info className="size-4 shrink-0 mt-0.5 text-[#8a5cda]" />
          <span>{t.live.setup.sourceHint}</span>
        </p>
        {(supportMessage || deviceError) && (
          <p className="mt-2 text-xs text-[#b91c1c] leading-relaxed" role="alert">
            {supportMessage ?? deviceError}
          </p>
        )}
      </div>

      <label
        htmlFor={consentId}
        className="flex items-start gap-2 text-xs text-[#60526c] leading-relaxed cursor-pointer"
      >
        <input
          id={consentId}
          type="checkbox"
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
          disabled={starting}
          className="mt-0.5 size-4 shrink-0 accent-[#8a5cda]"
        />
        <span>{t.live.setup.consentLabel}</span>
      </label>

      <Button
        variant="filled"
        size="default"
        onClick={() => onStart({ deviceId })}
        disabled={starting || !consented || Boolean(supportProblem)}
        disabledTooltip={!consented ? t.live.setup.consentRequired : undefined}
        className="w-full"
      >
        <Play className="size-5" />
        {starting ? t.live.status.requesting_permission : t.live.controls.start}
      </Button>

      <p className="text-xs text-[#81788b] leading-relaxed">
        {t.live.setup.privacyNote}
      </p>
    </div>
  );
};

export default LiveSetupPanel;
