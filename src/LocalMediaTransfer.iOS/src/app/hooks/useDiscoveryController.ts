import React from 'react';
import { DiscoveredServer, nativeCapabilities } from '@/services/NativeCapabilities';

export function useDiscoveryController({ enabled }: { enabled: boolean }) {
  const [discoveredServers, setDiscoveredServers] = React.useState<DiscoveredServer[]>([]);
  const [isDiscovering, setIsDiscovering] = React.useState(false);
  const [discoveryFailed, setDiscoveryFailed] = React.useState(false);

  const performDiscovery = React.useCallback(async () => {
    if (!nativeCapabilities.available) return;
    setIsDiscovering(true);
    setDiscoveryFailed(false);
    try {
      setDiscoveredServers(await nativeCapabilities.discover(1500));
    } catch {
      console.warn('Desktop discovery failed.');
      setDiscoveredServers([]);
      setDiscoveryFailed(true);
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  const discoverServers = React.useCallback(() => {
    if (enabled) return performDiscovery();
  }, [enabled, performDiscovery]);

  const clearDiscoveredServers = React.useCallback(() => {
    setDiscoveredServers([]);
    setDiscoveryFailed(false);
  }, []);

  return {
    discoveredServers,
    setDiscoveredServers,
    isDiscovering,
    discoveryFailed,
    performDiscovery,
    discoverServers,
    clearDiscoveredServers,
  };
}
