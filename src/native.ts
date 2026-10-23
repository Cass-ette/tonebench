import { useEffect, useState } from 'react';
import type { Band } from './audio';

export type AudioStatus = {
  phase: 'stopped' | 'starting' | 'running' | 'error';
  message: string;
  outputDevice: string;
  sampleRate: number;
  clipped: number;
};
export type AudioSettings = {
  bands: Band[];
  preamp: number;
  bypass: boolean;
  autoPreamp: boolean;
};
declare global {
  interface Window {
    __TONEBENCH_NATIVE__?: boolean;
    webkit?: {
      messageHandlers?: {
        tonebench?: { postMessage: (message: unknown) => void };
      };
    };
  }
}
export const isNative = () =>
  window.__TONEBENCH_NATIVE__ === true &&
  !!window.webkit?.messageHandlers?.tonebench;
export function nativeMessage(message: unknown): boolean {
  if (!isNative()) return false;
  window.webkit!.messageHandlers!.tonebench!.postMessage(message);
  return true;
}
export function useSystemAudio(settings: AudioSettings) {
  const [status, setStatus] = useState<AudioStatus>({
    phase: 'stopped',
    message: '',
    outputDevice: '',
    sampleRate: 48000,
    clipped: 0,
  });
  const native = isNative();
  useEffect(() => {
    if (!native) return;
    const receive = (event: Event) => {
      const data = (event as CustomEvent<unknown>).detail;
      if (!data || typeof data !== 'object') return;
      const s = data as AudioStatus;
      if (
        !['stopped', 'starting', 'running', 'error'].includes(s.phase) ||
        typeof s.message !== 'string' ||
        typeof s.outputDevice !== 'string' ||
        !Number.isFinite(s.sampleRate) ||
        s.sampleRate < 32000 ||
        s.sampleRate > 192000 ||
        !Number.isFinite(s.clipped)
      )
        return;
      setStatus(s);
    };
    window.addEventListener('tonebench:audio', receive);
    nativeMessage({ action: 'ready' });
    return () => window.removeEventListener('tonebench:audio', receive);
  }, [native]);
  const { bands, preamp, bypass, autoPreamp } = settings;
  useEffect(() => {
    if (native)
      nativeMessage({
        action: 'update',
        settings: { bands, preamp, bypass, autoPreamp },
      });
  }, [native, bands, preamp, bypass, autoPreamp]);
  return {
    native,
    status,
    start: () => nativeMessage({ action: 'start', settings }),
    stop: () => nativeMessage({ action: 'stop' }),
  };
}
