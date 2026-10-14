export type MobileClientEnvironment = 'production' | 'test';

const configuredEnvironment = process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;

export function configuredMobileEnvironment(): MobileClientEnvironment | null {
  if (configuredEnvironment === 'production' || configuredEnvironment === 'test') {
    return configuredEnvironment;
  }
  return null;
}

export function mobileClientEnvironment(nativeAvailable: boolean): MobileClientEnvironment {
  // Expo Go cannot load the environment-scoped native module and is always a
  // TEST client, even if a production build variable is present in the shell.
  if (!nativeAvailable) return 'test';
  return configuredMobileEnvironment() ?? 'production';
}

export function discoveryPortForEnvironment(environment: MobileClientEnvironment): number {
  return environment === 'test' ? 45893 : 45892;
}

export function environmentStorageKey(
  key: string,
  nativeAvailable: boolean,
): string {
  // Unit tests use the historic production key names unless they explicitly
  // exercise this helper. Runtime TEST and Expo Go clients remain isolated.
  if (process.env.NODE_ENV === 'test') {
    return key;
  }
  const environment = mobileClientEnvironment(nativeAvailable);
  return environmentStorageKeyForProfile(key, environment, nativeAvailable);
}

export function environmentStorageKeyForProfile(
  key: string,
  environment: MobileClientEnvironment,
  nativeAvailable: boolean,
): string {
  if (environment === 'production' && nativeAvailable) return key;
  return `${key}_${environment}_${nativeAvailable ? 'installed' : 'expo-go'}`;
}
