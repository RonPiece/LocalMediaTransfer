export type IosClientEnvironment = 'production' | 'test';

const configuredEnvironment = process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;

export function configuredIosEnvironment(): IosClientEnvironment | null {
  if (configuredEnvironment === 'production' || configuredEnvironment === 'test') {
    return configuredEnvironment;
  }
  return null;
}

export function iosClientEnvironment(nativeAvailable: boolean): IosClientEnvironment {
  // Expo Go cannot load the environment-scoped native module and is always a
  // TEST client, even if a production build variable is present in the shell.
  if (!nativeAvailable) return 'test';
  return configuredIosEnvironment() ?? 'production';
}

export function discoveryPortForEnvironment(environment: IosClientEnvironment): number {
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
  const environment = iosClientEnvironment(nativeAvailable);
  return environmentStorageKeyForProfile(key, environment, nativeAvailable);
}

export function environmentStorageKeyForProfile(
  key: string,
  environment: IosClientEnvironment,
  nativeAvailable: boolean,
): string {
  if (environment === 'production' && nativeAvailable) return key;
  return `${key}_${environment}_${nativeAvailable ? 'installed' : 'expo-go'}`;
}
