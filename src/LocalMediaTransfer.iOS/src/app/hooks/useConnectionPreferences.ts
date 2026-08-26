import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectionStorageKeys } from '@/config/storageKeys';

const ignorePersistenceError = () => undefined;

export function useConnectionPreferences({
  onPersistenceError = ignorePersistenceError,
}: {
  onPersistenceError?: () => void;
} = {}) {
  const [nearbyDiscoveryEnabled, setNearbyDiscoveryEnabled] = React.useState(false);
  const [allowInsecureHttp, setAllowInsecureHttp] = React.useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(connectionStorageKeys.nearbyDiscovery())
      .then(value => setNearbyDiscoveryEnabled(value === 'true'))
      .catch(() => {
        setNearbyDiscoveryEnabled(false);
        onPersistenceError();
      });
  }, [onPersistenceError]);

  React.useEffect(() => {
    AsyncStorage.getItem(connectionStorageKeys.allowInsecureHttp())
      .then(value => setAllowInsecureHttp(value === 'true'))
      .catch(() => {
        setAllowInsecureHttp(false);
        onPersistenceError();
      });
  }, [onPersistenceError]);

  const persistNearbyDiscovery = React.useCallback((enabled: boolean) => {
    setNearbyDiscoveryEnabled(enabled);
    void AsyncStorage.setItem(connectionStorageKeys.nearbyDiscovery(), enabled ? 'true' : 'false')
      .catch(() => onPersistenceError());
  }, [onPersistenceError]);

  const persistAllowInsecureHttp = React.useCallback(async (enabled: boolean) => {
    setAllowInsecureHttp(enabled);
    await AsyncStorage.setItem(connectionStorageKeys.allowInsecureHttp(), enabled ? 'true' : 'false')
      .catch(() => onPersistenceError());
  }, [onPersistenceError]);

  return {
    nearbyDiscoveryEnabled,
    setNearbyDiscoveryEnabled,
    allowInsecureHttp,
    setAllowInsecureHttp,
    persistNearbyDiscovery,
    persistAllowInsecureHttp,
  };
}
