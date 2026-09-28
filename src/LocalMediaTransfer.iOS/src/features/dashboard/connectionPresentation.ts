import type { ConnectionHealthStatus, ConnectionSecurityState } from '@/app/types';
import type { Tone } from '@/theme';
import { dashboardText } from './content/dashboardText';

// Resolve the displayed state once. Connectivity is not proof of verified TLS.
export function connectionStatusPresentation({ isConnected, connectionHealthStatus, connectionSecurity }: {
  isConnected: boolean;
  connectionHealthStatus: ConnectionHealthStatus;
  connectionSecurity: ConnectionSecurityState;
}): { label: string; tone: Tone } {
  if (connectionHealthStatus === 'checking' || connectionHealthStatus === 'retrying') {
    return { label: dashboardText.reconnectingStatus, tone: 'info' };
  }
  if (!isConnected) return { label: dashboardText.disconnectedStatus, tone: 'warning' };
  if (connectionSecurity.mode === 'http') return { label: dashboardText.httpStatus, tone: 'error' };
  if (connectionSecurity.mode === 'https' && connectionSecurity.certificateVerified) {
    return { label: dashboardText.encryptedStatus(connectionSecurity.tlsVersion || 'TLS'), tone: 'success' };
  }
  return { label: dashboardText.unverifiedStatus, tone: 'warning' };
}
