import { connectionStatusPresentation } from './connectionPresentation';
import type { ConnectionHealthStatus, ConnectionSecurityState } from '@/app/types';

describe('connection status presentation', () => {
  it.each(['checking', 'retrying'] as ConnectionHealthStatus[])('prioritizes %s over a remembered secure state', connectionHealthStatus => {
    expect(connectionStatusPresentation({ isConnected: true, connectionHealthStatus, connectionSecurity: { mode: 'https', certificateVerified: true } }).tone).toBe('info');
  });
  it.each([
    [false, { mode: 'https', certificateVerified: true }, 'warning', 'Desktop unavailable'],
    [true, { mode: 'http', certificateVerified: false }, 'error', 'Using HTTP'],
    [true, { mode: 'https', certificateVerified: false }, 'warning', 'Connection verification unavailable'],
    [true, { mode: 'disconnected', certificateVerified: false }, 'warning', 'Connection verification unavailable'],
    [true, { mode: 'https', certificateVerified: true, tlsVersion: 'TLS 1.3' }, 'success', 'Encrypted · TLS 1.3 · certificate verified'],
  ] as [boolean, ConnectionSecurityState, string, string][])('resolves connectivity/security consistently', (isConnected, connectionSecurity, tone, label) => {
    expect(connectionStatusPresentation({ isConnected, connectionHealthStatus: isConnected ? 'connected' : 'disconnected', connectionSecurity })).toEqual({ tone, label });
  });
});
