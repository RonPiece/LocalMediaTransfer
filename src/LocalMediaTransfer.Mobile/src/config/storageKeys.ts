import { environmentStorageKey } from './runtimeEnvironment';
import { nativeCapabilities } from '@/services/NativeCapabilities';

export function storageKey(key: string): string {
  return environmentStorageKey(key, nativeCapabilities.available);
}

export const connectionStorageKeys = {
  deviceIdentity: () => storageKey('lmt_device_identity'),
  deviceId: () => storageKey('lmt_device_id'),
  deviceCredential: () => storageKey('lmt_device_credential'),
  lastServer: () => storageKey('lmt_last_server'),
  nearbyDiscovery: () => storageKey('lmt_nearby_discovery'),
  allowInsecureHttp: () => storageKey('lmt_allow_insecure_http'),
  preparationMode: () => storageKey('lmt_preparation_mode'),
  skipExactDuplicates: () => storageKey('lmt_skip_exact_duplicates'),
  includeAdditionalMediaComponents: () => storageKey('lmt_include_additional_media_components'),
};
