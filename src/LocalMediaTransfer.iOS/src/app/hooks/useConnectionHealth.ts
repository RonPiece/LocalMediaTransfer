import React from 'react';
import { AppState as NativeAppState } from 'react-native';

import { api } from '@/api/ApiClient';
import { ConnectionHealthStatus, ScreenState } from '../types';

const HEALTH_POLL_INTERVAL_MS = 5000;
const HEALTH_RETRY_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_FAILURES = 3;

type ConnectionHealthScheduler = {
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
};

const systemScheduler: ConnectionHealthScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: timer => clearTimeout(timer),
};

/**
 * Monitors an already-open dashboard connection. Establishing a connection is
 * deliberately user-driven through QR/manual entry or a Nearby Desktop tap.
 */
export function useConnectionHealth({
  appState,
  setIsServerConnected,
  scheduler = systemScheduler,
}: {
  appState: ScreenState;
  setIsServerConnected: (connected: boolean) => void;
  scheduler?: ConnectionHealthScheduler;
}) {
  const [status, setStatus] = React.useState<ConnectionHealthStatus>('idle');
  const [manualRetryId, setManualRetryId] = React.useState(0);

  React.useEffect(() => {
    if (appState !== 'dashboard') {
      setStatus('idle');
      return;
    }
    let stopped = false;
    let inFlight = false;
    let consecutiveFailures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      if (stopped) return;
      if (timer) scheduler.cancel(timer);
      timer = scheduler.schedule(() => void validateConnection(), delayMs);
    };

    async function validateConnection() {
      if (stopped || inFlight) return;
      inFlight = true;
      const ok = await api.pingServer({ notifyUnauthorized: false });
      inFlight = false;
      if (stopped) return;
      setIsServerConnected(ok);
      if (ok) {
        consecutiveFailures = 0;
        setStatus('connected');
        schedule(HEALTH_POLL_INTERVAL_MS);
        return;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        setStatus('disconnected');
        return;
      }
      setStatus('retrying');
      schedule(HEALTH_RETRY_INTERVAL_MS);
    }

    setStatus('checking');
    void validateConnection();
    const subscription = NativeAppState.addEventListener('change', state => {
      if (state === 'active') {
        consecutiveFailures = 0;
        setStatus('checking');
        if (timer) scheduler.cancel(timer);
        timer = null;
        void validateConnection();
      }
    });
    return () => {
      stopped = true;
      if (timer) scheduler.cancel(timer);
      subscription.remove();
    };
  }, [appState, manualRetryId, scheduler, setIsServerConnected]);

  const retryConnection = React.useCallback(() => {
    setStatus('checking');
    setManualRetryId(value => value + 1);
  }, []);

  return { status, retryConnection };
}
