import type { ConnectionHealthStatus, ConnectionSecurityState, SavedConnection } from '@/app/types';
import type { DiscoveredServer } from '@/services/NativeCapabilities';

/** Public display state only. Never include pairing tokens or device credentials. */
export type ActiveConnection = Readonly<{
  address: string;
  name: string;
  healthStatus: ConnectionHealthStatus;
  security: Readonly<ConnectionSecurityState>;
  trusted: boolean;
}>;

export function receiverOrigin(address?: string | null): string | null {
  if (!address) return null;
  try {
    const url = new URL(address);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

export function discoveredReceiverAddress(server: DiscoveredServer): string {
  const host = server.address.includes(':') && !server.address.startsWith('[') ? `[${server.address}]` : server.address;
  return `https://${host}:${server.httpsPort}`;
}

export function createActiveConnection({ address, isConnected, savedReceiver, discoveredServers, security, healthStatus }: {
  address: string; isConnected: boolean; savedReceiver: SavedConnection | null;
  discoveredServers: DiscoveredServer[]; security: ConnectionSecurityState; healthStatus: ConnectionHealthStatus;
}): ActiveConnection | null {
  const origin = receiverOrigin(address);
  if (!isConnected || !origin) return null;
  const trusted = receiverOrigin(savedReceiver?.httpsUrl) === origin;
  const discovered = discoveredServers.find(server => receiverOrigin(discoveredReceiverAddress(server)) === origin);
  const name = (trusted ? savedReceiver?.name?.trim() : undefined) || discovered?.name.trim() || new URL(origin).hostname;
  return { address: origin, name, healthStatus, security: { ...security }, trusted };
}

export function receiverRowState({ address, activeConnection, isConnected, isConnecting }: {
  address: string; activeConnection: ActiveConnection | null; isConnected: boolean; isConnecting: boolean;
}) {
  const origin = receiverOrigin(address);
  const connected = isConnected && !!origin && origin === activeConnection?.address;
  const disabled = !origin || isConnecting || (isConnected && !connected);
  return { connected, disabled, busy: isConnecting,
    action: !origin ? 'Address unavailable' : isConnecting ? 'Connection in progress' : connected ? 'View connection details'
      : isConnected ? 'Disconnect to connect' : 'Tap to connect securely' };
}
