import { expectedServerEnvironment, nativeCapabilities } from '@/services/NativeCapabilities';
import { PairingPayload } from '@/security/ConnectionSecurity';
import type { Alert } from 'react-native';

type TransportOptions = {
  nativeHttpsAvailable: boolean;
  effectiveAllowInsecureHttp: boolean;
  showAlertOnce: (title: string, message?: string, buttons?: Parameters<typeof Alert.alert>[2]) => void;
  httpConfirmed: boolean;
  confirmHttpFallback: () => Promise<boolean>;
};

/** Validates environment/consent and configures pinning before any credential request. */
export async function configurePairingTransport(
  ipOrUrl: string, token: string, pairing: PairingPayload | undefined, silent: boolean,
  { nativeHttpsAvailable, effectiveAllowInsecureHttp, showAlertOnce,
    httpConfirmed, confirmHttpFallback }: TransportOptions,
): Promise<{ url: string; httpConfirmed: boolean } | null> {
  const expectedEnvironment = expectedServerEnvironment();
  if (pairing && pairing.environment !== expectedEnvironment) {
    if (!silent) {
      showAlertOnce(
        'Wrong desktop environment',
        `This app expects the ${expectedEnvironment} Windows environment, but the QR code is for ${pairing.environment}. Open the matching Windows app and scan its QR code.`,
      );
    }
    return null;
  }
  let url = ipOrUrl.trim();
  if (!url.startsWith('http')) url = `https://${url}:8443`;
  if (url.startsWith('http://')) {
    const needsHttpConfirmation = nativeHttpsAvailable && !httpConfirmed;
    if (silent || !effectiveAllowInsecureHttp || (needsHttpConfirmation && !(await confirmHttpFallback()))) {
      if (!silent && !effectiveAllowInsecureHttp) {
        showAlertOnce('HTTP disabled', 'Turn on unencrypted HTTP in iOS settings before connecting to an older desktop build.');
      }
      return null;
    }
    httpConfirmed = true;
  } else {
    if (!pairing?.certificateFingerprint || !token) {
      if (!silent) showAlertOnce('Fingerprint and token required', 'Scan the Windows pairing QR or enter its SHA-256 fingerprint and session token.');
      return null;
    }
    try {
      await nativeCapabilities.configureSecureConnection(url, pairing.certificateFingerprint);
    } catch (error) {
      console.warn('HTTPS pairing failed while configuring pinned certificate trust.');
      if (!silent) showAlertOnce('Secure connection unavailable', error instanceof Error ? error.message : 'Use the installed app for pinned HTTPS.');
      return null;
    }
  }

  return { url, httpConfirmed };
}
